import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, '../uploads');

const upsertChunksMock = jest.fn(async () => undefined);
const generarEmbeddingMock = jest.fn(async () => new Array(768).fill(0.01));

function dividirEnChunksTest(texto, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let inicio = 0;
  while (inicio < texto.length) {
    const fin = Math.min(inicio + chunkSize, texto.length);
    chunks.push(texto.slice(inicio, fin));
    inicio += chunkSize - overlap;
    if (inicio >= texto.length) break;
  }
  return chunks;
}

jest.unstable_mockModule('../services/gemini.service.js', () => ({
  isGeminiConfigured: () => false,
  getLastWorkingModel: () => null,
  isModelInCooldown: () => false,
  obtenerModelosCandidatosGeneracion: () => [],
  generarContenidoMultimodalGemini: jest.fn(async () => ({
    texto: null,
    modelo: null,
    latencia_ms: 0,
  })),
  generarContenidoChatGemini: jest.fn(async () => ({
    texto: null,
    modelo: null,
    latencia_ms: 0,
  })),
  generarEmbeddingGoogle: generarEmbeddingMock,
  esVectorDeRespaldo: () => true,
  getActiveModel: () => null,
  getActiveEmbeddingModel: () => null,
  warmupGeminiRAG: jest.fn(async () => ({
    activeModel: null,
    embeddingModel: null,
    disponible: false,
  })),
  analizarDocumentoConGemini: jest.fn(async () => ({
    categoria_detectada: 'Otros',
    score_confianza: 70,
    resumen_ia: '',
    metadatos: {},
  })),
  dividirEnChunks: dividirEnChunksTest,
}));

jest.unstable_mockModule('../services/pinecone.service.js', () => ({
  upsertChunks: upsertChunksMock,
  queryVectores: jest.fn(async () => []),
  eliminarVectoresDocumento: jest.fn(async () => undefined),
}));

const { default: app } = await import('../app.js');
const { default: db } = await import('../config/db.js');

const JWT_SECRET = process.env.JWT_SECRET || 'uts_clavedesarrollo_secreta_documind_2026';

function crearToken(usuario) {
  return jwt.sign(usuario, JWT_SECRET, { expiresIn: '1h' });
}

describe('Escáner Documental Universal - Modo 1: Digitalizar hacia la Bóveda', () => {
  let dbQuerySpy;
  let archivosAntes;

  beforeEach(() => {
    jest.clearAllMocks();
    dbQuerySpy = jest.spyOn(db, 'query').mockResolvedValue([]);
    archivosAntes = new Set(fs.readdirSync(uploadsDir));
  });

  afterEach(() => {
    if (dbQuerySpy && dbQuerySpy.mockRestore) dbQuerySpy.mockRestore();

    for (const archivo of fs.readdirSync(uploadsDir)) {
      if (!archivosAntes.has(archivo) && archivo.startsWith('vision-')) {
        try {
          fs.unlinkSync(path.join(uploadsDir, archivo));
        } catch {
          console.warn(`[Test Cleanup] No se pudo eliminar ${archivo}`);
        }
      }
    }
  });

  test('modo=boveda sin JWT devuelve 401', async () => {
    const res = await request(app)
      .post('/api/vision/procesar-formulario')
      .field('modo', 'boveda');

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.mensaje).toMatch(/Inicia sesi[oó]n para digitalizar/i);
  });

  test('modo=boveda autenticado extrae datos_documento del documento general', async () => {
    const token = crearToken({
      id: 10,
      nombre: 'Agente Bóveda',
      email: 'boveda@documind.com',
      rol: 'AGENTE',
    });

    const contenido = [
      'CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES',
      'Emisor: TechFlow S.A.S. NIT 890.201.223-4',
      'Receptor: Comercializadora Andina S.A.S.',
      'Fecha: 2026-03-15',
      'Valor total: $ 12.500.000 COP',
      'Entre las partes se acuerda la prestación de servicios tecnológicos con vigencia de doce meses.',
    ].join('\n');

    const res = await request(app)
      .post('/api/vision/procesar-formulario')
      .set('Authorization', `Bearer ${token}`)
      .field('modo', 'boveda')
      .attach('archivo', Buffer.from(contenido, 'utf8'), {
        filename: 'contrato_servicios.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('success');
    expect(res.body.modo).toBe('boveda');
    expect(res.body.archivo.archivo_servidor).toMatch(/^vision-/);
    expect(res.body.datos_documento).toBeDefined();
    expect(res.body.datos_documento.titulo_sugerido).toEqual(expect.any(String));
    expect(res.body.datos_documento.tipo_documento).toEqual(expect.any(String));
    expect(res.body.datos_documento.resumen_ejecutivo).toEqual(expect.any(String));
    expect(res.body.datos_documento.texto_ocr_completo).toEqual(expect.any(String));
    expect(res.body.datos_documento.entidades_clave).toEqual(
      expect.objectContaining({
        emisor: expect.anything(),
        receptor: expect.anything(),
        documento_id_o_nit: expect.anything(),
        fecha_documento: expect.anything(),
        monto_total: expect.anything(),
      })
    );
    expect(res.body.datos_documento.tipo_documento).toBe('Contrato');
  });

  test('POST /api/vision/indexar-documento rechaza con 403 cuando el rol departamental no coincide', async () => {
    dbQuerySpy.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM repositorios WHERE id = ?')) {
        return [{ id: 1, departamento: 'Legal', usuario_id: 1 }];
      }
      return [];
    });

    const token = crearToken({
      id: 4,
      nombre: 'Contador Financiero',
      email: 'finanzas@documind.com',
      rol: 'FINANCIERO',
    });

    const res = await request(app)
      .post('/api/vision/indexar-documento')
      .set('Authorization', `Bearer ${token}`)
      .send({
        repositorio_id: 1,
        titulo_archivo: 'Contrato confidencial',
        tipo_documento: 'Contrato',
        resumen_ejecutivo: 'Contrato reservado del área legal.',
        texto_ocr_completo: 'Contenido reservado para el departamento Legal.',
      });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.mensaje).toMatch(/permisos/i);
    expect(upsertChunksMock).not.toHaveBeenCalled();
  });

  test('POST /api/vision/indexar-documento indexa con 201, guarda en DB e invoca chunks y Pinecone', async () => {
    const inserts = [];

    dbQuerySpy.mockImplementation(async (sql, params = []) => {
      const consulta = String(sql);

      if (consulta.includes('FROM repositorios WHERE id = ?')) {
        return [{ id: 1, departamento: 'Legal', usuario_id: 1 }];
      }
      if (consulta.includes('INSERT INTO documentos')) {
        inserts.push({ tipo: 'documento', sql: consulta, params });
        return { insertId: 777 };
      }
      if (consulta.includes('INSERT INTO metadatos_extraidos')) {
        inserts.push({ tipo: 'metadatos', sql: consulta, params });
        return { insertId: 1 };
      }
      if (consulta.includes('SELECT * FROM documentos WHERE id = ?')) {
        return [{
          id: 777,
          nombre_archivo: 'Acta de reunión comité',
          estado_procesamiento: 'COMPLETADO',
          categoria_detectada: 'Acta',
          score_confianza: 0.88,
          repositorio_id: 1,
          url_descarga: '/uploads/vision-boveda-respaldo.txt',
        }];
      }
      return [];
    });

    const token = crearToken({
      id: 2,
      nombre: 'Agente Operativo',
      email: 'agente@documind.com',
      rol: 'AGENTE',
    });

    const textoOcr = [
      'ACTA DE REUNIÓN ORDINARIA DEL COMITÉ DIRECTIVO',
      'Se aprueban los acuerdos de seguimiento presupuestal y las responsabilidades asignadas.',
      'Los participantes validan el plan de acción y la fecha de próxima sesión.',
    ].join('\n') + `\n${'Contenido amplio de soporte para indexación semántica. '.repeat(80)}`;

    const res = await request(app)
      .post('/api/vision/indexar-documento')
      .set('Authorization', `Bearer ${token}`)
      .send({
        repositorio_id: 1,
        titulo_archivo: 'Acta de reunión comité',
        tipo_documento: 'Acta',
        resumen_ejecutivo: 'Acta de reunión del comité directivo con acuerdos y responsables.',
        texto_ocr_completo: textoOcr,
        metadatos: JSON.stringify({
          autor: 'Secretaría General',
          numero_acta: 'ACTA-2026-014',
        }),
        score_confianza: 0.88,
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.mensaje).toMatch(/indexado exitosamente en la b[oó]veda/i);
    expect(res.body.documento).toBeDefined();
    expect(res.body.documento.id).toBe(777);
    expect(res.body.chunks_indexados).toBeGreaterThan(0);
    expect(generarEmbeddingMock).toHaveBeenCalledTimes(res.body.chunks_indexados);
    expect(upsertChunksMock).toHaveBeenCalledTimes(1);

    const [chunks, documentoId, repositorioId, nombreArchivo, urlDescarga] = upsertChunksMock.mock.calls[0];
    expect(chunks).toHaveLength(res.body.chunks_indexados);
    expect(documentoId).toBe(777);
    expect(repositorioId).toBe(1);
    expect(nombreArchivo).toBe('Acta de reunión comité');
    expect(urlDescarga).toMatch(/^\/uploads\/vision-boveda-.*\.txt$/);

    const insertDocumento = inserts.find((insert) => insert.tipo === 'documento');
    expect(insertDocumento).toBeDefined();
    expect(insertDocumento.sql).toContain("'COMPLETADO'");
    expect(insertDocumento.params).toContain('Acta');
    expect(insertDocumento.params).toContain(0.88);

    const resumenGuardado = insertDocumento.params.find(
      (parametro) => typeof parametro === 'string' && parametro.includes('Extracto del documento')
    );
    expect(resumenGuardado).toContain('ACTA DE REUNIÓN');
    expect(resumenGuardado).toMatch(/acuerdos y responsables/i);

    const insertMetadatos = inserts.find((insert) => insert.tipo === 'metadatos');
    expect(insertMetadatos).toBeDefined();
    expect(JSON.parse(insertMetadatos.params[1])).toMatchObject({
      autor: 'Secretaría General',
      numero_acta: 'ACTA-2026-014',
      origen: 'VISION_BOVEDA',
      tipo_formato: 'TXT',
    });

    const nombreRespaldo = path.basename(urlDescarga);
    expect(fs.existsSync(path.join(uploadsDir, nombreRespaldo))).toBe(true);
  });
});
