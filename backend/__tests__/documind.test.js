import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

// ─── Aislamiento determinista de dependencias externas ───────────────────────
// La suite debe pasar sin PostgreSQL, sin Gemini y sin Pinecone disponibles.
// Se simula el SDK de Google (para que el pipeline use sus fallbacks heurísticos
// y de vector hash) y se evita cualquier llamada de red a Pinecone.
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    constructor() {
      this.models = {
        generateContent: async () => {
          throw new Error('Google GenAI no disponible en pruebas offline');
        },
        embedContent: async () => {
          throw new Error('Embeddings no disponibles en pruebas offline');
        },
      };
    }
  },
}));

jest.unstable_mockModule('../services/pinecone.service.js', () => ({
  upsertChunks: async () => {},
  queryVectores: async () => [],
  eliminarVectoresDocumento: async () => {},
}));

describe('Pruebas de API y Pipeline de IA - DocuMind', () => {
  let authToken;
  let app;
  let db;

  // Estado en memoria que emula las tablas consultadas por los endpoints usados
  // en esta suite. Permite validar el pipeline completo de ingesta y el chat RAG
  // cuando PostgreSQL no está corriendo (ECONNREFUSED ::1:5432).
  const repositorios = [
    {
      id: 1,
      nombre: 'Repositorio Legal',
      descripcion: 'Contratos y documentos legales',
      departamento: 'Legal',
      usuario_id: 4,
      creado_en: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    },
  ];
  const usuarios = [
    {
      id: 4,
      nombre: 'Diana Rodríguez',
      email: 'diana.legal@documind.com',
      password_hash: bcrypt.hashSync('password_seguro_uts', 4),
      rol: 'LEGAL',
    },
  ];
  const documentos = [];
  let nextDocumentoId = 1;

  function crearMockDbQuery() {
    return async (sql, params = []) => {
      const sentencia = String(sql).replace(/\s+/g, ' ').trim();
      const upper = sentencia.toUpperCase();

      // Usuarios (login)
      if (upper.startsWith('SELECT * FROM USUARIOS WHERE EMAIL')) {
        const email = String(params[0] || '').toLowerCase().trim();
        return usuarios.filter((u) => u.email.toLowerCase() === email).map((u) => ({ ...u }));
      }

      // Repositorios
      if (upper.includes('FROM REPOSITORIOS')) {
        if (upper.includes('WHERE ID =')) {
          const id = Number(params[0]);
          const repo = repositorios.find((r) => r.id === id);
          return repo ? [{ ...repo }] : [];
        }
        if (upper.includes('WHERE DEPARTAMENTO =') && upper.includes('USUARIO_ID')) {
          const [departamento, usuarioId] = params;
          return repositorios
            .filter(
              (r) =>
                r.departamento === departamento ||
                Number(r.usuario_id) === Number(usuarioId)
            )
            .map((r) => ({ id: r.id }));
        }
        return repositorios.map((r) => ({ ...r }));
      }

      // Ingesta: alta de documento en estado PROCESANDO
      if (upper.startsWith('INSERT INTO DOCUMENTOS')) {
        const [nombre_archivo, url_descarga, tipo_formato, tamano_bytes, repositorio_id] = params;
        const documento = {
          id: nextDocumentoId++,
          nombre_archivo,
          url_descarga,
          tipo_formato,
          tamano_bytes,
          estado_procesamiento: 'PROCESANDO',
          repositorio_id: Number(repositorio_id),
          categoria_detectada: null,
          score_confianza: null,
          resumen_ia: null,
          creado_en: new Date().toISOString(),
        };
        documentos.push(documento);
        return { insertId: documento.id, affectedRows: 1 };
      }

      // Ingesta: metadatos extraídos por IA
      if (upper.startsWith('INSERT INTO METADATOS_EXTRAIDOS')) {
        return { insertId: 1, affectedRows: 1 };
      }

      // Ingesta: actualización de estado y metadatos del documento
      if (upper.startsWith('UPDATE DOCUMENTOS')) {
        const id = Number(params[params.length - 1]);
        const documento = documentos.find((d) => d.id === id);
        if (documento) {
          if (upper.includes("ESTADO_PROCESAMIENTO = 'COMPLETADO'")) {
            documento.estado_procesamiento = 'COMPLETADO';
            documento.categoria_detectada = params[0];
            documento.score_confianza = params[1];
            documento.resumen_ia = params[2];
          } else if (upper.includes("ESTADO_PROCESAMIENTO = 'ERROR'")) {
            documento.estado_procesamiento = 'ERROR';
          }
        }
        return { affectedRows: documento ? 1 : 0 };
      }

      // Lectura puntual de un documento
      if (upper.startsWith('SELECT * FROM DOCUMENTOS WHERE ID =')) {
        const id = Number(params[0]);
        const documento = documentos.find((d) => d.id === id);
        return documento ? [{ ...documento }] : [];
      }

      // Búsqueda léxica de respaldo del Chat RAG
      if (
        upper.includes('FROM DOCUMENTOS') &&
        upper.includes("ESTADO_PROCESAMIENTO = 'COMPLETADO'")
      ) {
        // Validación de vigencia de documentos provenientes de Pinecone
        if (upper.includes('WHERE ID IN (')) {
          const ids = params.map(Number);
          return documentos
            .filter((d) => ids.includes(d.id) && d.estado_procesamiento === 'COMPLETADO')
            .map((d) => ({ id: d.id }));
        }

        let resultado = documentos.filter((d) => d.estado_procesamiento === 'COMPLETADO');

        const patrones = params.filter(
          (p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')
        );
        if (patrones.length > 0) {
          resultado = resultado.filter((d) =>
            patrones.some((patron) => {
              const termino = patron.slice(1, -1).toLowerCase();
              return [d.nombre_archivo, d.resumen_ia, d.categoria_detectada].some((valor) =>
                String(valor || '').toLowerCase().includes(termino)
              );
            })
          );
        }

        const filtroRepo = sentencia.match(/REPOSITORIO_ID IN \(([^)]*)\)/i);
        if (filtroRepo) {
          const cantidad = (filtroRepo[1].match(/\?/g) || []).length;
          const reposPermitidos = params.slice(-cantidad).map(Number);
          resultado = resultado.filter((d) =>
            reposPermitidos.includes(Number(d.repositorio_id))
          );
        }

        return resultado
          .sort((a, b) => b.id - a.id)
          .slice(0, 8)
          .map((d) => ({ ...d }));
      }

      // Registro de errores de ingesta
      if (upper.startsWith('INSERT INTO LOGS_ERRORES')) {
        return { insertId: 1, affectedRows: 1 };
      }

      return [];
    };
  }

  beforeAll(async () => {
    ({ default: db } = await import('../config/db.js'));
    // Repositorio de datos en memoria: evita cualquier conexión real a PostgreSQL.
    db.query = crearMockDbQuery();

    ({ default: app } = await import('../app.js'));

    // Autenticar al analista para obtener el token JWT de las pruebas
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'diana.legal@documind.com',
        password: 'password_seguro_uts',
      });
    authToken = res.body?.token || jwt.sign(
      { id: 4, nombre: 'Diana Rodríguez', email: 'diana.legal@documind.com', rol: 'LEGAL' },
      process.env.JWT_SECRET || 'uts_clavedesarrollo_secreta_documind_2026',
      { expiresIn: '2h' }
    );
  });

  afterAll(async () => {
    await db.end(); // Cerrar pool de PostgreSQL al finalizar las pruebas
  });

  // ─── CP-01: Inicio de sesión seguro ─────────────────────────────────────────
  test('CP-01: Login exitoso de usuario registrado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'diana.legal@documind.com',
        password: 'password_seguro_uts',
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.usuario).toHaveProperty('rol');
  });

  test('CP-01b: Login fallido con contraseña incorrecta', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'diana.legal@documind.com',
        password: 'clave_incorrecta',
      });
    expect(res.statusCode).toEqual(401);
    expect(res.body.ok).toBeFalsy();
  });

  test('CP-01c: Acceso a ruta protegida sin token retorna 401', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.statusCode).toEqual(401);
  });

  // ─── CP-05 & CP-06: Ingesta Documental ──────────────────────────────────────
  test('CP-05: Carga exitosa de PDF válido e inicio de pipeline', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .field('repositorio_id', 1)
      .attach(
        'file',
        Buffer.from('Contenido ficticio de un contrato de servicios corporativos entre las partes...'),
        'contrato_prueba.pdf'
      );

    expect(res.statusCode).toEqual(201);
    expect(res.body.documento.estado_procesamiento).toEqual('COMPLETADO');
    expect(res.body.documento.categoria_detectada).toEqual('Contrato');
  }, 60000); // Timeout extendido para llamada a Gemini API

  test('CP-06: Rechazo de archivos ejecutables maliciosos (.exe)', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .field('repositorio_id', 1)
      .attach('file', Buffer.from('exec() malicious code'), 'test_virus.exe');

    expect(res.statusCode).toEqual(400);
    expect(res.body.ok).toBeFalsy();
  });

  test('CP-06b: Rechazo de archivos que exceden 15 MB', async () => {
    // Generar buffer de ~16 MB
    const bigBuffer = Buffer.alloc(16 * 1024 * 1024, 'x');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .field('repositorio_id', 1)
      .attach('file', bigBuffer, 'archivo_enorme.pdf');

    expect(res.statusCode).toEqual(400);
  });

  // ─── CP-15 & CP-16: Chat RAG ─────────────────────────────────────────────────
  test('CP-15: Consulta con coincidencias retorna fuentes citadas', async () => {
    const res = await request(app)
      .post('/api/chat/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '¿Qué penalizaciones tiene el contrato?' });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('respuesta');
    expect(res.body.fuentes_citadas.length).toBeGreaterThan(0);
  }, 30000);

  test('CP-16: Consulta sin contexto retorna respuesta honesta sin alucinaciones', async () => {
    const res = await request(app)
      .post('/api/chat/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '¿Cuál es la órbita de Júpiter y Saturno?' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.respuesta).toContain('No he encontrado información relevante en los documentos cargados');
  }, 30000);

  // ─── Health Check ────────────────────────────────────────────────────────────
  test('Health check retorna 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.ok).toBeTruthy();
  });
});
