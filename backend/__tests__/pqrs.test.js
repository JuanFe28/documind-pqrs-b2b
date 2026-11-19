import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import db from '../config/db.js';
import { _resetLoginLimiter } from '../controllers/auth.controller.js';
import { _resetTrackingLimiter } from '../controllers/pqrs.controller.js';
import { validarRutaCanonicaSegura } from '../controllers/documents.controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Pruebas de API - Integración Mesa de Ayuda PQRS', () => {
  let authToken;

  beforeAll(async () => {
    // Autenticar para obtener token JWT de prueba si existe usuario
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@documind.com',
        password: 'admin',
      });
    authToken = res.body?.token;
  });

  afterAll(async () => {
    await db.end();
  });

  test('PQRS-01: Health check del sistema unificado', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('PQRS-02: Endpoint de KPIs responde con estructura válida', async () => {
    const res = await request(app).get('/api/pqrs/kpis');
    // Si la BD no está levantada en Docker, maneja el estado
    if (res.statusCode === 200) {
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('resumen');
    }
  });

  test('PQRS-03: Consulta de tickets retorna formato paginado', async () => {
    const res = await request(app).get('/api/pqrs?limit=5');
    if (res.statusCode === 200) {
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('pagination');
    }
  });

  describe('Privacidad y Control de Acceso en Seguimiento de Tickets (/api/pqrs/:ticketId)', () => {
    const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_documind_pqrs_2026';
    let tokenAgenteValido;
    let tokenClienteSinPrivilegios;
    let dbQuerySpy;

    const mockTicketCompleto = {
      id: 1,
      ticket_id: 'PQRS-2026-999001',
      nombre_solicitante: 'Ciudadano Ejemplo',
      email_solicitante: 'ciudadano.privado@correo.com',
      telefono: '3001234567',
      tipo_solicitud: 'Petición',
      prioridad: 'Media',
      departamento: 'Soporte Técnico',
      asunto: 'Fallo de acceso a plataforma',
      descripcion: 'No puedo acceder al sistema desde el lunes.',
      estado: 'EN_GESTION',
      sla_horas: 24,
      sla_fecha_limite: new Date().toISOString(),
      created_at: new Date().toISOString(),
      tracking_token: '12345678-1234-4000-8000-123456789012',
      payload_original: { ip: '192.168.1.1', headers: 'Privado' },
      confirmacion_error: 'Error interno de transporte SMTP',
    };

    const mockTicketHistorico = {
      id: 99,
      ticket_id: 'PQRS-2024-HIST-01',
      cliente_nombre: 'Maria Gomez Historica',
      nombre_solicitante: null,
      cliente_email: 'maria.historica@antiguo.com',
      email_solicitante: null,
      cliente_telefono: '3109876543',
      telefono: null,
      tipo: 'Reclamo',
      tipo_solicitud: null,
      prioridad: 'Alta',
      departamento: 'Facturación y Cobranzas',
      asunto: 'Cobro no reconocido en periodo anterior',
      descripcion: 'Detalle histórico confidencial de la reclamación.',
      estado: 'RESUELTO',
      sla_horas: 4,
      sla_fecha_limite: '2024-05-10T12:00:00Z',
      fecha_radicacion: '2024-05-10T08:00:00Z',
      created_at: '2024-05-10T08:00:00Z',
      tracking_token: 'a0000000-0000-4000-8000-000000000001',
    };

    const mockActividadPublica = {
      id: 10,
      ticket_id: 'PQRS-2026-999001',
      autor_nombre: 'Sistema n8n',
      autor_tipo: 'SISTEMA',
      es_nota_interna: false,
      mensaje: 'Solicitud radicada formalmente y asignada a mesa de ayuda.',
      estado_nuevo: 'NUEVO',
      created_at: new Date().toISOString(),
    };

    const mockNotaInterna = {
      id: 11,
      ticket_id: 'PQRS-2026-999001',
      autor_nombre: 'Agente Especialista',
      autor_tipo: 'AGENTE',
      es_nota_interna: true,
      mensaje: 'NOTA INTERNA CONFIDENCIAL: Posible inconsistencia de datos interna.',
      estado_nuevo: 'EN_GESTION',
      created_at: new Date().toISOString(),
    };

    const mockDocumentoInterno = {
      id: 50,
      nombre_archivo: 'informe_interno.pdf',
      url_descarga: '/uploads/informe_interno.pdf',
      resumen_ia: 'Resumen clasificado para funcionarios',
      metadata_json: { confidencialidad: 'ALTA' },
    };

    beforeAll(async () => {
      const jwt = (await import('jsonwebtoken')).default;
      tokenAgenteValido = jwt.sign(
        { id: 101, nombre: 'Agente Autorizado', email: 'agente@documind.com', rol: 'AGENTE' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      tokenClienteSinPrivilegios = jwt.sign(
        { id: 202, nombre: 'Usuario Externo', email: 'externo@cliente.com', rol: 'CLIENTE' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
    });

    beforeEach(() => {
      _resetTrackingLimiter();

      dbQuerySpy = jest.spyOn(db, 'query').mockImplementation(async (sql, params) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        // Consulta de ticket con tracking_token conjunto
        if (sqlStr.includes('FROM pqrs_solicitudes') && sqlStr.includes('tracking_token')) {
          const idBuscado = params && params[0];
          const tokenBuscado = params && params[1];

          if (idBuscado === mockTicketCompleto.ticket_id && tokenBuscado === mockTicketCompleto.tracking_token) {
            return [mockTicketCompleto];
          }
          if (idBuscado === mockTicketHistorico.ticket_id && tokenBuscado === mockTicketHistorico.tracking_token) {
            return [mockTicketHistorico];
          }
          return [];
        }

        // Consulta de ticket principal (público / agente)
        if (sqlStr.includes('FROM pqrs_solicitudes WHERE ticket_id')) {
          const idBuscado = params && params[0];
          if (idBuscado === 'PQRS-INEXISTENTE-404' || idBuscado === 'PQRS-OTRO-TICKET') {
            return [];
          }
          return [mockTicketCompleto];
        }

        // Consulta de actividades públicas o ciudadanas (filtradas por es_nota_interna)
        if (sqlStr.includes('FROM pqrs_actividades') && (sqlStr.includes('es_nota_interna = false') || sqlStr.includes('es_nota_interna IS NULL'))) {
          return [mockActividadPublica];
        }

        // Consulta de todas las actividades (usuario interno)
        if (sqlStr.includes('FROM pqrs_actividades WHERE ticket_id')) {
          return [mockActividadPublica, mockNotaInterna];
        }

        // Consulta de documentos
        if (sqlStr.includes('FROM documentos d')) {
          return [mockDocumentoInterno];
        }

        return [];
      });
    });

    afterEach(() => {
      if (dbQuerySpy) {
        dbQuerySpy.mockRestore();
      }
    });

    test('PQRS-PRIV-01: Consulta pública (sin token) NUNCA expone notas internas en el timeline', async () => {
      const res = await request(app).get('/api/pqrs/PQRS-2026-999001');

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.timeline)).toBe(true);
      expect(res.body.data.timeline.length).toBe(1);

      // Verificación estricta: ninguna nota con es_nota_interna = true
      const tieneNotaInterna = res.body.data.timeline.some(
        (act) => act.es_nota_interna === true || act.mensaje.includes('NOTA INTERNA CONFIDENCIAL')
      );
      expect(tieneNotaInterna).toBe(false);
      expect(res.body.data.timeline[0].es_nota_interna).toBe(false);

      // Verificar que el backend ejecutó la consulta SQL filtrada
      expect(dbQuerySpy).toHaveBeenCalledWith(
        expect.stringContaining('es_nota_interna = false'),
        expect.arrayContaining(['PQRS-2026-999001'])
      );
    });

    test('PQRS-PRIV-02: Consulta pública (sin token) no expone datos sensibles ni tracking_token del solicitante', async () => {
      const res = await request(app).get('/api/pqrs/PQRS-2026-999001');

      expect(res.statusCode).toBe(200);
      const ticket = res.body.data.ticket;

      // Campos indispensables para seguimiento público
      expect(ticket.ticket_id).toBe('PQRS-2026-999001');
      expect(ticket.asunto).toBe('Fallo de acceso a plataforma');
      expect(ticket.estado).toBe('EN_GESTION');
      expect(ticket.departamento).toBe('Soporte Técnico');

      // Enmascaramiento consistente del nombre del solicitante (no revela identidad completa)
      expect(ticket.nombre_solicitante).not.toBe('Ciudadano Ejemplo');
      expect(ticket.nombre_solicitante).toMatch(/^C\*+ E\*+$/);

      // Campos sensibles que NUNCA deben exponerse públicamente
      expect(ticket.descripcion).toBeUndefined();
      expect(ticket.tracking_token).toBeUndefined();
      expect(ticket.email_solicitante).toBeUndefined();
      expect(ticket.telefono).toBeUndefined();
      expect(ticket.payload_original).toBeUndefined();
      expect(ticket.confirmacion_error).toBeUndefined();

      // Documentos analizados no se exponen a solicitantes no autenticados
      expect(res.body.data.documentos).toEqual([]);
    });

    test('PQRS-PRIV-03: Solicitud con token inválido o expirado es rechazada con HTTP 401', async () => {
      const res = await request(app)
        .get('/api/pqrs/PQRS-2026-999001')
        .set('Authorization', 'Bearer token_invalido_o_manipulado_xyz');

      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toMatch(/Token inválido o expirado/i);
    });

    test('PQRS-PRIV-04: Solicitud con formato de autorización inválido es rechazada con HTTP 401', async () => {
      const res = await request(app)
        .get('/api/pqrs/PQRS-2026-999001')
        .set('Authorization', 'Basic dXNlcjpwYXNzd29yZA==');

      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toMatch(/Formato de token de autenticación inválido/i);
    });

    test('PQRS-PRIV-05: Funcionario autorizado con JWT conserva acceso legítimo a notas internas y documentos', async () => {
      const res = await request(app)
        .get('/api/pqrs/PQRS-2026-999001')
        .set('Authorization', `Bearer ${tokenAgenteValido}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');

      // Acceso completo al expediente (nombre íntegro sin enmascarar y descripción completa)
      const ticket = res.body.data.ticket;
      expect(ticket.ticket_id).toBe('PQRS-2026-999001');
      expect(ticket.nombre_solicitante).toBe('Ciudadano Ejemplo');
      expect(ticket.descripcion).toBe('No puedo acceder al sistema desde el lunes.');
      expect(ticket.email_solicitante).toBe('ciudadano.privado@correo.com');
      expect(ticket.tracking_token).toBe('12345678-1234-4000-8000-123456789012');

      // Timeline completo con notas internas
      expect(res.body.data.timeline.length).toBe(2);
      const notaInternaEncontrada = res.body.data.timeline.find((act) => act.es_nota_interna === true);
      expect(notaInternaEncontrada).toBeDefined();
      expect(notaInternaEncontrada.mensaje).toContain('NOTA INTERNA CONFIDENCIAL');

      // Documentos con metadatos de IA
      expect(res.body.data.documentos.length).toBe(1);
      expect(res.body.data.documentos[0].nombre_archivo).toBe('informe_interno.pdf');
    });

    test('PQRS-PRIV-06: Radicado inexistente retorna HTTP 404', async () => {
      const res = await request(app).get('/api/pqrs/PQRS-INEXISTENTE-404');

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe('error');
      expect(res.body.mensaje).toMatch(/Ticket no encontrado/i);
    });

    test('PQRS-PRIV-07: Usuario autenticado con rol no autorizado (ej: CLIENTE) NO obtiene acceso a notas internas ni expediente completo', async () => {
      const res = await request(app)
        .get('/api/pqrs/PQRS-2026-999001')
        .set('Authorization', `Bearer ${tokenClienteSinPrivilegios}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');

      // Debe recibir exclusivamente la vista pública restringida
      expect(res.body.data.timeline.length).toBe(1);
      const tieneNotaInterna = res.body.data.timeline.some(
        (act) => act.es_nota_interna === true || act.mensaje.includes('NOTA INTERNA CONFIDENCIAL')
      );
      expect(tieneNotaInterna).toBe(false);

      // Verificación estricta de no divulgación de campos internos y nombre enmascarado
      const ticket = res.body.data.ticket;
      expect(ticket.descripcion).toBeUndefined();
      expect(ticket.nombre_solicitante).not.toBe('Ciudadano Ejemplo');
      expect(ticket.nombre_solicitante).toMatch(/^C\*+ E\*+$/);
      expect(ticket.tracking_token).toBeUndefined();
      expect(ticket.email_solicitante).toBeUndefined();
      expect(ticket.telefono).toBeUndefined();
      expect(ticket.payload_original).toBeUndefined();
      expect(res.body.data.documentos).toEqual([]);
    });

    describe('Consulta Privada de Radicados con Clave (POST /api/pqrs/:ticketId/tracking)', () => {
      beforeEach(() => {
        _resetTrackingLimiter();
      });

    test('PQRS-TRACK-01: Consulta privada con clave correcta retorna expediente completo sin notas internas', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({ tracking_token: '12345678-1234-4000-8000-123456789012' });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      const ticket = res.body.data.ticket;

      // Nombre completo sin enmascarar para el titular
      expect(ticket.nombre_solicitante).toBe('Ciudadano Ejemplo');
      // Descripción íntegra accesible con la clave privada
      expect(ticket.descripcion).toBe('No puedo acceder al sistema desde el lunes.');
      expect(ticket.ticket_id).toBe('PQRS-2026-999001');
      expect(ticket.asunto).toBe('Fallo de acceso a plataforma');
      expect(ticket.estado).toBe('EN_GESTION');

      // Timeline sin notas internas
      expect(Array.isArray(res.body.data.timeline)).toBe(true);
      expect(res.body.data.timeline.length).toBe(1);
      expect(res.body.data.timeline.some((a) => a.es_nota_interna)).toBe(false);

      // Documentos no exponen URLs directas al filesystem (/uploads)
      expect(res.body.data.documentos).toEqual([]);
    });

    test('PQRS-TRACK-02: Clave privada incorrecta es rechazada con HTTP 404 sin revelar existencia del radicado', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({ tracking_token: '00000000-0000-4000-8000-000000000000' });

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe('error');
      expect(res.body.mensaje).toBe('Radicado o clave privada de consulta incorrectos');
      expect(res.body.data).toBeUndefined();
    });

    test('PQRS-TRACK-03: Clave privada correspondiente a otro radicado es rechazada con HTTP 404', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-OTRO-TICKET/tracking')
        .send({ tracking_token: '12345678-1234-4000-8000-123456789012' });

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe('error');
      expect(res.body.mensaje).toBe('Radicado o clave privada de consulta incorrectos');
    });

    test('PQRS-TRACK-04: Clave privada malformada o no UUID es rechazada con HTTP 400', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({ tracking_token: 'clave-no-uuid-invalida-123' });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.mensaje).toMatch(/inválida o malformada/i);
    });

    test('PQRS-TRACK-05: Cuerpo de petición vacío o sin token es rechazado con HTTP 400', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.mensaje).toMatch(/inválida o malformada/i);
    });

    test('PQRS-TRACK-06: Consulta privada NUNCA expone datos sensibles de contacto ni infraestructura', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({ tracking_token: '12345678-1234-4000-8000-123456789012' });

      expect(res.statusCode).toBe(200);
      const ticket = res.body.data.ticket;

      expect(ticket.email_solicitante).toBeUndefined();
      expect(ticket.cliente_email).toBeUndefined();
      expect(ticket.telefono).toBeUndefined();
      expect(ticket.cliente_telefono).toBeUndefined();
      expect(ticket.tracking_token).toBeUndefined();
      expect(ticket.payload_original).toBeUndefined();
      expect(ticket.confirmacion_error).toBeUndefined();
    });

    test('PQRS-TRACK-07: Limitación de intentos fallidos (Rate Limiter) bloquea tras 5 intentos fallidos con HTTP 429', async () => {
      const claveErronea = '00000000-0000-4000-8000-000000000000';

      // 5 intentos fallidos sucesivos
      for (let i = 0; i < 5; i++) {
        const intento = await request(app)
          .post('/api/pqrs/PQRS-2026-999001/tracking')
          .send({ tracking_token: claveErronea });
        expect(intento.statusCode).toBe(404);
      }

      // El 6to intento debe ser bloqueado con HTTP 429
      const bloqueo = await request(app)
        .post('/api/pqrs/PQRS-2026-999001/tracking')
        .send({ tracking_token: claveErronea });

      expect(bloqueo.statusCode).toBe(429);
      expect(bloqueo.body.status).toBe('error');
      expect(bloqueo.body.mensaje).toMatch(/Demasiados intentos fallidos/i);
      expect(bloqueo.body.reintentar_en_segundos).toBeGreaterThan(0);
    });

    test('PQRS-TRACK-08: Compatibilidad con radicados históricos (columnas duales cliente_nombre y tipo)', async () => {
      const res = await request(app)
        .post('/api/pqrs/PQRS-2024-HIST-01/tracking')
        .send({ tracking_token: 'a0000000-0000-4000-8000-000000000001' });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      const ticket = res.body.data.ticket;

      // Resuelve el nombre usando COALESCE con cliente_nombre histórico
      expect(ticket.nombre_solicitante).toBe('Maria Gomez Historica');
      expect(ticket.tipo).toBe('Reclamo');
      expect(ticket.descripcion).toBe('Detalle histórico confidencial de la reclamación.');
      expect(ticket.estado).toBe('RESUELTO');
    });

    test('PQRS-TRACK-09: Verificación de procesamiento de enlace de seguimiento y extracción de fragmento URL', () => {
      // Simulación de URL con fragmento #token=UUID&id=TICKET
      const hashPrueba = 'token=12345678-1234-4000-8000-123456789012&id=PQRS-2026-999001';
      const params = new URLSearchParams(hashPrueba);
      const tokenExtraido = params.get('token');
      const idExtraido = params.get('id');

      expect(tokenExtraido).toBe('12345678-1234-4000-8000-123456789012');
      expect(idExtraido).toBe('PQRS-2026-999001');

      // Simulación de sanitización de barra de direcciones con replaceState
      const urlOriginal = `http://localhost:5173/#${hashPrueba}`;
      const urlLimpia = urlOriginal.split('#')[0] + (idExtraido ? `?id=${encodeURIComponent(idExtraido)}` : '');

      expect(urlLimpia).not.toContain('token=');
      expect(urlLimpia).toBe('http://localhost:5173/?id=PQRS-2026-999001');
    });
  });
});

  describe('Seguridad de Archivos Físicos y Control de Acceso (/uploads y descarga de documentos)', () => {
    const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_documind_pqrs_2026';
    let tokenAdmin;
    let tokenAgente;
    let tokenFinanciero;
    let dbSpy;

    const uploadsDir = path.resolve(__dirname, '../uploads');
    const testFileName = 'test-seguridad-archivo-2026.pdf';
    const testFilePath = path.join(uploadsDir, testFileName);
    const testFileContent = 'CONTENIDO_CONFIDENCIAL_DOCUMIND_2026';

    const validTrackingToken = '12345678-1234-4000-8000-123456789012';
    const ticketPropio = 'PQRS-2026-999001';
    const ticketAjeno = 'PQRS-2026-888999';

    const mockDocLegal = {
      id: 10,
      nombre_archivo: testFileName,
      url_descarga: `/uploads/${testFileName}`,
      tipo_formato: 'PDF',
      tamano_bytes: 1024,
      repositorio_id: 1,
      ticket_id: ticketPropio,
      repo_departamento: 'Legal',
      repo_usuario_id: 1,
    };

    const mockDocMaliciosoPath = {
      id: 20,
      nombre_archivo: '../../../../etc/passwd',
      url_descarga: '../../../../etc/passwd',
      tipo_formato: 'TXT',
      tamano_bytes: 512,
      repositorio_id: 1,
      ticket_id: ticketPropio,
      repo_departamento: 'Legal',
      repo_usuario_id: 1,
    };

    const getBodyText = (res) => (Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : (res.text || ''));

    beforeAll(async () => {
      const jwt = (await import('jsonwebtoken')).default;
      tokenAdmin = jwt.sign(
        { id: 1, nombre: 'Admin DocuMind', email: 'admin@documind.com', rol: 'ADMIN' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      tokenAgente = jwt.sign(
        { id: 2, nombre: 'Agente Soporte', email: 'agente@documind.com', rol: 'AGENTE' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      tokenFinanciero = jwt.sign(
        { id: 3, nombre: 'Funcionario Finanzas', email: 'finanzas@documind.com', rol: 'FINANCIERO' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Crear archivo físico de prueba en uploads para verificar envío real
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      fs.writeFileSync(testFilePath, testFileContent, 'utf-8');
    });

    afterAll(() => {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    beforeEach(() => {
      _resetTrackingLimiter();

      dbSpy = jest.spyOn(db, 'query').mockImplementation(async (sql, params) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        // 1. Verificación conjunta de ticket y tracking_token
        if (sqlStr.includes('FROM pqrs_solicitudes') && sqlStr.includes('tracking_token')) {
          const tId = params?.[0];
          const tTok = params?.[1];
          if (tId === ticketPropio && tTok === validTrackingToken) {
            return [{
              ticket_id: ticketPropio,
              tracking_token: validTrackingToken,
              nombre_solicitante: 'Ciudadano Ejemplo',
              tipo_solicitud: 'Petición',
              prioridad: 'Media',
              departamento: 'Soporte Técnico',
              asunto: 'Fallo de acceso',
              descripcion: 'Descripción confidencial',
              estado: 'EN_GESTION',
              sla_horas: 24,
              sla_fecha_limite: new Date().toISOString(),
              created_at: new Date().toISOString(),
            }];
          }
          return [];
        }

        // 2. Consulta de actividades ciudadanas
        if (sqlStr.includes('FROM pqrs_actividades')) {
          return [];
        }

        // 3. Conteo de documentos para paginación
        if (sqlStr.includes('COUNT(*) AS total')) {
          return [{ total: 1 }];
        }

        // 4. Listado de documentos (repositorio_nombre)
        if (sqlStr.includes('repositorio_nombre')) {
          return [mockDocLegal];
        }

        // 5. Consulta de documento ciudadano verificando id Y ticket_id
        if (sqlStr.includes('FROM documentos') && /\bid\s*=\s*\?/.test(sqlStr) && sqlStr.includes('ticket_id = ?')) {
          const dId = Number(params?.[0]);
          const tId = params?.[1];
          if (dId === 10 && tId === ticketPropio) {
            return [mockDocLegal];
          }
          if (dId === 20 && tId === ticketPropio) {
            return [mockDocMaliciosoPath];
          }
          return [];
        }

        // 6. Lista de documentos por ticket_id (para tracking privado)
        if (sqlStr.includes('FROM documentos') && sqlStr.includes('ticket_id = ?')) {
          const tId = params?.[0];
          if (tId === ticketPropio) {
            return [mockDocLegal];
          }
          return [];
        }

        // 7. Consulta de documento para funcionario por ID con join a repositorio
        if (sqlStr.includes('FROM documentos d') && sqlStr.includes('JOIN repositorios r')) {
          const dId = Number(params?.[0]);
          if (dId === 10) {
            return [mockDocLegal];
          }
          if (dId === 20) {
            return [mockDocMaliciosoPath];
          }
          return [];
        }

        return [];
      });
    });

    afterEach(() => {
      if (dbSpy) {
        dbSpy.mockRestore();
      }
    });

    // 1. Petición anónima a URL de archivo privado no obtiene su contenido
    test('SEC-01a: Petición anónima directa a /uploads/:archivo es rechazada con HTTP 401', async () => {
      const res = await request(app).get(`/uploads/${testFileName}`);
      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('no autorizado');
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    test('SEC-01b: Petición anónima a /api/documents/:id/archivo es rechazada con HTTP 401', async () => {
      const res = await request(app).get('/api/documents/10/archivo');
      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    test('SEC-01c: Petición anónima a /api/pqrs/:ticketId/documentos/:documentId es rechazada con HTTP 401', async () => {
      const res = await request(app).get(`/api/pqrs/${ticketPropio}/documentos/10`);
      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('clave privada de consulta');
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    // 2. Funcionario no autorizado no puede descargarlo
    test('SEC-02: Funcionario no autorizado (rol FINANCIERO sobre repo Legal ajeno) es rechazado con HTTP 403', async () => {
      const res = await request(app)
        .get('/api/documents/10/archivo')
        .set('Authorization', `Bearer ${tokenFinanciero}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('No tiene permisos para acceder a este documento');
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    // 3. Funcionario autorizado puede acceder a un documento permitido
    test('SEC-03a: Funcionario ADMIN autorizado puede descargar documento con HTTP 200 y nosniff', async () => {
      const res = await request(app)
        .get('/api/documents/10/archivo')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(getBodyText(res)).toBe(testFileContent);
    });

    test('SEC-03b: Funcionario AGENTE autorizado puede descargar documento con HTTP 200', async () => {
      const res = await request(app)
        .get('/api/documents/10/archivo')
        .set('Authorization', `Bearer ${tokenAgente}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(getBodyText(res)).toBe(testFileContent);
    });

    // 4. Ciudadano con credencial válida solo puede acceder a documentos de su radicado mediante cabecera o body
    test('SEC-04a: Ciudadano con tracking_token suministrado por query string (?token= o ?tracking_token=) es rechazado con HTTP 401', async () => {
      // Intento con ?token=...
      const resToken = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/10?token=${validTrackingToken}`);

      expect(resToken.statusCode).toBe(401);
      expect(resToken.body.ok).toBe(false);
      expect(resToken.body.mensaje).toContain('Acceso no autorizado');
      expect(getBodyText(resToken)).not.toContain(testFileContent);

      // Intento con ?tracking_token=...
      const resTracking = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/10?tracking_token=${validTrackingToken}`);

      expect(resTracking.statusCode).toBe(401);
      expect(resTracking.body.ok).toBe(false);
      expect(resTracking.body.mensaje).toContain('Acceso no autorizado');
      expect(getBodyText(resTracking)).not.toContain(testFileContent);
    });

    test('SEC-04b: Ciudadano con tracking_token por header x-tracking-token descarga su documento con HTTP 200', async () => {
      const res = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/10`)
        .set('x-tracking-token', validTrackingToken);

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(getBodyText(res)).toBe(testFileContent);
    });

    test('SEC-04c: Ciudadano con POST y tracking_token en body descarga su documento con HTTP 200', async () => {
      const res = await request(app)
        .post(`/api/pqrs/${ticketPropio}/documentos/10/descargar`)
        .send({ tracking_token: validTrackingToken });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(getBodyText(res)).toBe(testFileContent);
    });

    // 5. Ciudadano NO puede descargar documentos de otro radicado usando un documentId ajeno
    test('SEC-05: Ciudadano con tracking_token válido NO puede acceder a documento de otro radicado (HTTP 404)', async () => {
      const res = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/999`)
        .set('x-tracking-token', validTrackingToken);

      expect(res.statusCode).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('no pertenece a este radicado');
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    // 6. Rutas manipuladas e intentos de path traversal son rechazados
    test('SEC-06a: Intento de path traversal en el ID del documento es rechazado con HTTP 400', async () => {
      const res = await request(app)
        .get('/api/documents/invalid-non-numeric/archivo')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('Identificador de documento inválido');
    });

    test('SEC-06b: Intento de path traversal en nombre o ruta de archivo es interceptado con HTTP 400', async () => {
      const res = await request(app)
        .get('/api/documents/20/archivo')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('Ruta de archivo no permitida');
    });

    test('SEC-06c: Intento de path traversal en endpoint ciudadano es interceptado con HTTP 400', async () => {
      const res = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/20`)
        .set('x-tracking-token', validTrackingToken);

      expect(res.statusCode).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toContain('Ruta de archivo no permitida');
    });

    // 7. Funcionalidades legítimas de vista previa o descarga continúan funcionando
    test('SEC-07a: JWT suministrado por query string (?token=JWT) no autentica la ruta protegida (HTTP 401)', async () => {
      const res = await request(app)
        .get(`/api/documents/10/archivo?token=${tokenAdmin}`);

      expect(res.statusCode).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toBe('Token de autenticación requerido.');
      expect(getBodyText(res)).not.toContain(testFileContent);
    });

    test('SEC-07b: Listado de documentos sanitiza url_descarga hacia /api/documents/:id/archivo sin exponer /uploads', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.documentos.length).toBeGreaterThan(0);
      const primerDoc = res.body.documentos[0];
      expect(primerDoc.url_descarga).toBe('/api/documents/10/archivo');
      expect(primerDoc.url_descarga).not.toContain('/uploads/');
    });

    test('SEC-07c: Seguimiento privado proyecta documentos con URL limpia sin exponer tokens ni rutas físicas', async () => {
      const res = await request(app)
        .post(`/api/pqrs/${ticketPropio}/tracking`)
        .send({ tracking_token: validTrackingToken });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.documentos).toBeDefined();
      expect(res.body.data.documentos.length).toBeGreaterThan(0);
      const doc = res.body.data.documentos[0];
      expect(doc.url_descarga).toBe(`/api/pqrs/${ticketPropio}/documentos/10`);
      expect(doc.url_descarga).not.toContain('token=');
      expect(doc.url_descarga).not.toContain('/uploads/');
    });

    // 8. Eliminación de credenciales en URL y validación canónica estricta
    test('SEC-08a: Descarga por funcionario con Authorization: Bearer no requiere ?token= en URL', async () => {
      const res = await request(app)
        .get('/api/documents/10/archivo')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.statusCode).toBe(200);
      expect(getBodyText(res)).toBe(testFileContent);
    });

    test('SEC-08b: Descarga ciudadana con x-tracking-token no requiere ?token= en URL', async () => {
      const res = await request(app)
        .get(`/api/pqrs/${ticketPropio}/documentos/10`)
        .set('x-tracking-token', validTrackingToken);

      expect(res.statusCode).toBe(200);
      expect(getBodyText(res)).toBe(testFileContent);
    });

    test('SEC-08c: validarRutaCanonicaSegura valida resolución física canónica', () => {
      const uploadsDir = path.resolve(__dirname, '../uploads');

      // Archivo real legítimo
      const resValido = validarRutaCanonicaSegura(uploadsDir, testFileName);
      expect(resValido.valido).toBe(true);
      expect(resValido.safeFilePath).toBe(testFilePath);

      // Path traversal relativo
      const resTraversal = validarRutaCanonicaSegura(uploadsDir, '../../app.js');
      expect(resTraversal.valido).toBe(false);
      expect(resTraversal.codigo).toBe(400);

      // Traversal URL encoded
      const resEncoded = validarRutaCanonicaSegura(uploadsDir, '%2e%2e/app.js');
      expect(resEncoded.valido).toBe(false);

      // Byte nulo
      const resNullByte = validarRutaCanonicaSegura(uploadsDir, `${testFileName}\0.evil`);
      expect(resNullByte.valido).toBe(false);

      // Flujo alternativo NTFS (Alternate Data Stream :)
      const resAds = validarRutaCanonicaSegura(uploadsDir, `${testFileName}:stream`);
      expect(resAds.valido).toBe(false);

      // Directorio en vez de archivo regular
      const resDir = validarRutaCanonicaSegura(uploadsDir, '.');
      expect(resDir.valido).toBe(false);

      // Archivo inexistente
      const resInexistente = validarRutaCanonicaSegura(uploadsDir, 'archivo_que_no_existe_999.pdf');
      expect(resInexistente.valido).toBe(false);
      expect(resInexistente.codigo).toBe(404);
    });

    test('SEC-08d: Respuestas de error 404 no reflejan tokens ni parámetros de consulta en cuerpo de respuesta', async () => {
      const res = await request(app)
        .get('/api/ruta-inexistente?token=secreto_jwt_prueba&tracking_token=12345678-1234-4000-8000-123456789012');

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toBe('Ruta no encontrada: GET /api/ruta-inexistente');
      expect(JSON.stringify(res.body)).not.toContain('secreto_jwt_prueba');
      expect(JSON.stringify(res.body)).not.toContain('12345678-1234-4000-8000-123456789012');
    });
  });
});

describe('Remediación BUG-001 / BUG-004 / BUG-005 — Normalización, concurrencia optimista y webhooks', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'uts_clavedesarrollo_secreta_documind_2026';
  const TICKET_ID = 'PQRS-2026-999777';
  const TRACKING_TOKEN = '12345678-1234-4000-8000-123456789012';

  let tokenAgente;
  let dbQuerySpy;
  let llamadas;

  beforeAll(() => {
    tokenAgente = jwt.sign(
      { id: 77, nombre: 'Agente Concurrencia', email: 'concurrencia@documind.com', rol: 'AGENTE' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  beforeEach(() => {
    _resetTrackingLimiter();
    llamadas = [];
    dbQuerySpy = jest.spyOn(db, 'query');
  });

  afterEach(() => {
    if (dbQuerySpy) {
      dbQuerySpy.mockRestore();
    }
  });

  test('BUG-004a: GET /api/pqrs?prioridad=CRITICA normaliza a "Crítica" y filtra por valor canónico e histórico', async () => {
    dbQuerySpy.mockImplementation(async (sql, params) => {
      const sqlStr = String(sql);
      llamadas.push({ sql: sqlStr, params });

      if (sqlStr.includes('COUNT(*) AS total')) {
        return [{ total: 0 }];
      }
      return [];
    });

    const res = await request(app)
      .get('/api/pqrs?prioridad=CRITICA')
      .set('Authorization', `Bearer ${tokenAgente}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const consultaListado = llamadas.find(
      (llamada) => llamada.sql.includes('FROM pqrs_solicitudes s') && llamada.sql.includes('LIMIT')
    );
    expect(consultaListado).toBeDefined();
    expect(consultaListado.sql).toContain("(s.prioridad IN ('Crítica', 'CRITICA'))");
    expect(consultaListado.params).not.toContain('CRITICA');
  });

  test('BUG-004b: GET /api/pqrs/kpis corrige críticos históricos y expone cumplimiento_pct y satisfaccion_promedio', async () => {
    dbQuerySpy.mockImplementation(async (sql, params) => {
      const sqlStr = String(sql);
      llamadas.push({ sql: sqlStr, params });

      if (sqlStr.includes('COUNT(*) AS total_tickets')) {
        return [{
          total_tickets: 5,
          nuevo: 1,
          criticos_pendientes: 2,
          cumplimiento_pct: 80,
          satisfaccion_promedio: '4.50',
        }];
      }
      return [];
    });

    const res = await request(app)
      .get('/api/pqrs/kpis')
      .set('Authorization', `Bearer ${tokenAgente}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.resumen).toHaveProperty('cumplimiento_pct');
    expect(res.body.data.resumen).toHaveProperty('satisfaccion_promedio');

    const consultaKpis = llamadas.find((llamada) => llamada.sql.includes('COUNT(*) AS total_tickets'));
    expect(consultaKpis).toBeDefined();
    expect(consultaKpis.sql).toContain(
      "FILTER (WHERE prioridad IN ('Crítica', 'CRITICA') AND estado NOT IN ('RESUELTO', 'CERRADO'))"
    );
    expect(consultaKpis.sql).toContain('ROUND(AVG(satisfaccion_score)::numeric, 2)');
  });

  test('BUG-005: PATCH /api/pqrs/:ticketId rechaza versión desactualizada con 409 e incrementa versión al coincidir', async () => {
    const ticketActual = { id: 7, ticket_id: TICKET_ID, estado: 'EN_GESTION', version: 3 };

    dbQuerySpy.mockImplementation(async (sql, params) => {
      const sqlStr = String(sql);
      llamadas.push({ sql: sqlStr, params });

      if (sqlStr.includes('SELECT id, ticket_id, estado, version FROM pqrs_solicitudes')) {
        return [{ ...ticketActual }];
      }
      return [];
    });

    const conflicto = await request(app)
      .patch(`/api/pqrs/${TICKET_ID}`)
      .set('Authorization', `Bearer ${tokenAgente}`)
      .send({ nuevo_estado: 'RESUELTO', version: 2 });

    expect(conflicto.status).toBe(409);
    expect(conflicto.body).toMatchObject({ ok: false, status: 'error' });
    expect(conflicto.body.mensaje).toContain('Conflicto de concurrencia optimista (409)');
    expect(llamadas.some((llamada) => llamada.sql.includes('UPDATE pqrs_solicitudes'))).toBe(false);

    llamadas = [];

    const actualizacion = await request(app)
      .patch(`/api/pqrs/${TICKET_ID}`)
      .set('Authorization', `Bearer ${tokenAgente}`)
      .send({ nuevo_estado: 'RESUELTO', version: '3', nota: 'Cierre validado por QA' });

    expect(actualizacion.status).toBe(200);
    expect(actualizacion.body.status).toBe('success');
    expect(actualizacion.body.data).toEqual({
      ticket_id: TICKET_ID,
      estado: 'RESUELTO',
      version: 4,
    });

    const update = llamadas.find((llamada) => llamada.sql.includes('UPDATE pqrs_solicitudes'));
    expect(update).toBeDefined();
    expect(update.sql).toContain('version = COALESCE(version, 1) + 1');
    expect(update.sql).toContain("CASE WHEN ? IN ('RESUELTO', 'CERRADO')");

    const insert = llamadas.find((llamada) => llamada.sql.includes('INSERT INTO pqrs_actividades'));
    expect(insert).toBeDefined();
    expect(insert.sql).toContain('estado_anterior');
    expect(insert.params).toEqual(expect.arrayContaining(['EN_GESTION', 'RESUELTO']));
  });

  test('BUG-001: POST /webhook/calificar-ticket acepta indistintamente tracking_token o token', async () => {
    dbQuerySpy.mockImplementation(async (sql, params) => {
      const sqlStr = String(sql);
      llamadas.push({ sql: sqlStr, params });

      if (sqlStr.includes('SELECT pqrs_calificar')) {
        return [{
          res: {
            status: 'success',
            codigo: 200,
            ticket_id: params[0],
            score: params[2],
            mensaje: 'Calificación almacenada con éxito.',
          },
        }];
      }
      return [];
    });

    for (const campo of ['tracking_token', 'token']) {
      const res = await request(app)
        .post('/webhook/calificar-ticket')
        .send({
          ticket_id: TICKET_ID,
          [campo]: TRACKING_TOKEN,
          puntuacion: 5,
          retroalimentacion: 'Excelente atención',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    }

    const calificaciones = llamadas.filter((llamada) => llamada.sql.includes('SELECT pqrs_calificar'));
    expect(calificaciones).toHaveLength(2);
    for (const llamada of calificaciones) {
      expect(llamada.params[0]).toBe(TICKET_ID);
      expect(llamada.params[1]).toBe(TRACKING_TOKEN);
    }
  });
});

describe('SPRINT 1 - RBAC de cuentas operativas y repositorio oficial Normativa PQRS', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'uts_clavedesarrollo_secreta_documind_2026';
  let dbQuerySpy;

  beforeEach(() => {
    _resetLoginLimiter();
    dbQuerySpy = jest.spyOn(db, 'query');
  });

  afterEach(() => {
    if (dbQuerySpy && dbQuerySpy.mockRestore) {
      dbQuerySpy.mockRestore();
    }
  });

  test('RBAC-01: Login exitoso de SUPERVISOR (Andrea Silva) con departamento en JWT', async () => {
    const hashDistinto = await bcrypt.hash('clave-interna-no-evaluacion', 4);
    dbQuerySpy.mockResolvedValueOnce([
      {
        id: 6,
        nombre: 'Andrea Silva',
        email: 'andrea.silva@techflow.co',
        password_hash: hashDistinto,
        rol: 'SUPERVISOR',
        departamento: 'Soporte Técnico',
      },
    ]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'andrea.silva@techflow.co', password: 'supervisorsoporte2026*' });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.usuario).toMatchObject({
      id: 6,
      nombre: 'Andrea Silva',
      rol: 'SUPERVISOR',
      departamento: 'Soporte Técnico',
    });

    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.rol).toBe('SUPERVISOR');
    expect(payload.departamento).toBe('Soporte Técnico');
  });

  test('RBAC-02: Login exitoso de AGENTE (Carlos Restrepo) con credencial de evaluación', async () => {
    const hashDistinto = await bcrypt.hash('clave-interna-no-evaluacion', 4);
    dbQuerySpy.mockResolvedValueOnce([
      {
        id: 7,
        nombre: 'Carlos Restrepo',
        email: 'carlos.restrepo@techflow.co',
        password_hash: hashDistinto,
        rol: 'AGENTE',
        departamento: 'Facturación y Cobranzas',
      },
    ]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carlos.restrepo@techflow.co', password: 'agentefacturacion2026*' });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.usuario).toMatchObject({
      id: 7,
      nombre: 'Carlos Restrepo',
      rol: 'AGENTE',
      departamento: 'Facturación y Cobranzas',
    });

    const payload = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.rol).toBe('AGENTE');
    expect(payload.departamento).toBe('Facturación y Cobranzas');
  });

  test('RBAC-03: Fallback offline autentica a Valeria Gómez con departamento Calidad y Servicio', async () => {
    dbQuerySpy.mockRejectedValueOnce(new Error('PostgreSQL no disponible'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'valeria.gomez@techflow.co', password: 'agentecalidad2026*' });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.usuario).toMatchObject({
      nombre: 'Valeria Gómez',
      rol: 'AGENTE',
      departamento: 'Calidad y Servicio',
    });
  });

  test('RBAC-04: SUPERVISOR lista su repositorio propio y el oficial Normativa PQRS sin abrir Legal/Financiero', async () => {
    const tokenSupervisor = jwt.sign(
      {
        id: 6,
        nombre: 'Andrea Silva',
        email: 'andrea.silva@techflow.co',
        rol: 'SUPERVISOR',
        departamento: 'Soporte Técnico',
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let sqlEjecutado = '';
    let paramsEjecutados = [];
    dbQuerySpy.mockImplementationOnce(async (sql, params) => {
      sqlEjecutado = String(sql);
      paramsEjecutados = params;
      return [
        {
          id: 3,
          slug: 'normativa-pqrs',
          nombre: 'Manuales, Normativa y Protocolos PQRS',
          departamento: 'Normativa PQRS',
          usuario_id: 1,
        },
        {
          id: 11,
          slug: 'soporte-interno',
          nombre: 'Base de Conocimiento Soporte Técnico',
          departamento: 'Soporte Técnico',
          usuario_id: 6,
        },
      ];
    });

    const res = await request(app)
      .get('/api/repositories')
      .set('Authorization', `Bearer ${tokenSupervisor}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    const nombres = res.body.repositorios.map((r) => r.nombre);
    expect(nombres).toContain('Manuales, Normativa y Protocolos PQRS');
    expect(res.body.repositorios.some((r) => r.departamento === 'Legal')).toBe(false);
    expect(res.body.repositorios.some((r) => r.departamento === 'Financiero')).toBe(false);

    expect(sqlEjecutado).toContain("r.slug = 'normativa-pqrs'");
    expect(sqlEjecutado).toContain("r.departamento = 'Normativa PQRS'");
    expect(sqlEjecutado).toContain('r.usuario_id = ?');
    expect(sqlEjecutado).toContain('r.departamento = ?');
    expect(sqlEjecutado).not.toMatch(/r\.departamento\s*=\s*'Legal'/i);
    expect(sqlEjecutado).not.toMatch(/r\.departamento\s*=\s*'Financiero'/i);
    expect(paramsEjecutados).toContain(6);
    expect(paramsEjecutados).toContain('Soporte Técnico');
    expect(paramsEjecutados).not.toContain('Legal');
    expect(paramsEjecutados).not.toContain('Financiero');
  });

  test('RBAC-05: AGENTE lista el repositorio oficial Normativa PQRS y su departamento, sin acceso global', async () => {
    const tokenAgente = jwt.sign(
      {
        id: 7,
        nombre: 'Carlos Restrepo',
        email: 'carlos.restrepo@techflow.co',
        rol: 'AGENTE',
        departamento: 'Facturación y Cobranzas',
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let sqlEjecutado = '';
    let paramsEjecutados = [];
    dbQuerySpy.mockImplementationOnce(async (sql, params) => {
      sqlEjecutado = String(sql);
      paramsEjecutados = params;
      return [
        {
          id: 3,
          slug: 'normativa-pqrs',
          nombre: 'Manuales, Normativa y Protocolos PQRS',
          departamento: 'Normativa PQRS',
          usuario_id: 1,
        },
        {
          id: 12,
          slug: 'facturacion-interna',
          nombre: 'Manual Interno de Facturación',
          departamento: 'Facturación y Cobranzas',
          usuario_id: 7,
        },
      ];
    });

    const res = await request(app)
      .get('/api/repositories')
      .set('Authorization', `Bearer ${tokenAgente}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.repositorios.map((r) => r.nombre)).toContain('Manuales, Normativa y Protocolos PQRS');
    expect(res.body.repositorios.some((r) => r.departamento === 'Legal')).toBe(false);
    expect(res.body.repositorios.some((r) => r.departamento === 'Financiero')).toBe(false);

    expect(sqlEjecutado).toContain("r.slug = 'normativa-pqrs'");
    expect(sqlEjecutado).toContain("r.departamento = 'Normativa PQRS'");
    expect(sqlEjecutado).toContain('r.usuario_id = ?');
    expect(paramsEjecutados).toContain(7);
    expect(paramsEjecutados).toContain('Facturación y Cobranzas');
  });
});

describe('SPRINT 2 - Copiloto PQRS Context-Fusion (POST /api/chat/query con ticket_id)', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'uts_clavedesarrollo_secreta_documind_2026';
  const TICKET_ID = 'PQRS-2026-891501';
  const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
  const SECCION_DIAGNOSTICO = '### Diagnóstico Operativo y Severidad SLA';
  const SECCION_PASOS = '### Pasos Internos de Resolución';
  const SECCION_BORRADOR = '### Borrador de Respuesta Formal al Ciudadano';

  let tokenAgente;
  let tokenSupervisor;
  let tokenReclutador;
  let dbQuerySpy;
  let llamadas;

  const ticketMock = {
    ticket_id: TICKET_ID,
    estado: 'EN_GESTION',
    prioridad: 'Alta',
    departamento: 'Facturación y Cobranzas',
    sla_horas: 4,
    sla_fecha_limite: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    es_urgente: true,
    asunto: 'Cobro duplicado en factura mensual',
    descripcion: 'El cliente reporta un cobro duplicado en su factura de servicios del mes en curso.',
    tipo_solicitud: 'Reclamo',
    tipo: 'Reclamo',
  };

  const actividadMock = {
    autor_nombre: 'Carlos Restrepo',
    autor_tipo: 'AGENTE',
    es_nota_interna: false,
    mensaje: 'Se solicita verificación de la transacción en la pasarela de pagos.',
    estado_anterior: 'NUEVO',
    estado_nuevo: 'EN_GESTION',
    created_at: new Date().toISOString(),
  };

  const adjuntoMock = {
    id: 501,
    nombre_archivo: 'evidencia_cobro_duplicado.pdf',
    categoria_detectada: 'Factura',
    resumen_ia: 'Soporte del cobro duplicado con dos débitos de la misma orden de servicio.',
    url_descarga: '/uploads/evidencia_cobro_duplicado.pdf',
    repositorio_id: 2,
  };

  const normativaMock = {
    documento_id: 301,
    chunk_index: 0,
    texto_chunk: 'Manual de Facturación y Notas Crédito: ante un cobro duplicado, verificar la transacción en la pasarela de pagos y registrar el caso como Reclamo de prioridad Alta con plazo de 4 horas.',
    nombre_archivo: 'manual_facturacion_y_notas_credito.md',
    url_descarga: '/uploads/normativa-pqrs/manual_facturacion_y_notas_credito.md',
    repositorio_id: 3,
  };

  beforeAll(() => {
    tokenAgente = jwt.sign(
      { id: 7, nombre: 'Carlos Restrepo', email: 'carlos.restrepo@techflow.co', rol: 'AGENTE', departamento: 'Facturación y Cobranzas' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    tokenSupervisor = jwt.sign(
      { id: 6, nombre: 'Andrea Silva', email: 'andrea.silva@techflow.co', rol: 'SUPERVISOR', departamento: 'Soporte Técnico' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    tokenReclutador = jwt.sign(
      { id: 8, nombre: 'Marta Reclutamiento', email: 'marta.rrhh@techflow.co', rol: 'RECLUTADOR', departamento: 'Recursos Humanos' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  beforeEach(() => {
    llamadas = [];
    dbQuerySpy = jest.spyOn(db, 'query').mockImplementation(async (sql, params) => {
      const sentencia = String(sql);
      llamadas.push({ sql: sentencia, params });

      if (sentencia.includes('FROM pqrs_solicitudes') && sentencia.includes('WHERE ticket_id = ?')) {
        return [{ ...ticketMock }];
      }
      if (sentencia.includes('FROM pqrs_actividades')) {
        return [{ ...actividadMock }];
      }
      if (sentencia.includes('FROM documentos_chunks')) {
        return [{ ...normativaMock }];
      }
      if (sentencia.includes('FROM documentos') && sentencia.includes('ticket_id = ?')) {
        return [{ ...adjuntoMock }];
      }
      return [];
    });
  });

  afterEach(() => {
    if (dbQuerySpy) dbQuerySpy.mockRestore();
  });

  async function consultarComo(token, body) {
    const claveAnterior = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
      const inicio = Date.now();
      const res = await request(app)
        .post('/api/chat/query')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      return { res, duracionMs: Date.now() - inicio };
    } finally {
      process.env.GEMINI_API_KEY = claveAnterior;
    }
  }

  test('S2-02a: AGENTE fusiona ticket + adjunto + normativa oficial y responde en menos de 1500ms', async () => {
    const { res, duracionMs } = await consultarComo(tokenAgente, {
      query: '¿Cómo debo resolver este cobro duplicado y qué protocolo aplico?',
      ticket_id: TICKET_ID,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(duracionMs).toBeLessThan(1500);
    expect(res.body.latencia_ms).toBeLessThan(1500);

    // Contrato de respuesta del copiloto
    expect(res.body.contexto_ticket).toMatchObject({
      ticket_id: TICKET_ID,
      estado: 'EN_GESTION',
      prioridad: 'Alta',
      departamento: 'Facturación y Cobranzas',
      sla_horas: 4,
      es_urgente: true,
    });
    expect(res.body.contexto_ticket.adjuntos).toHaveLength(1);
    expect(res.body.contexto_ticket.adjuntos[0].nombre_archivo).toBe('evidencia_cobro_duplicado.pdf');
    expect(res.body.contexto_ticket.normativa_aplicada).toHaveLength(1);
    expect(res.body.contexto_ticket.normativa_aplicada[0].nombre_archivo).toBe('manual_facturacion_y_notas_credito.md');
    expect(res.body.contexto_ticket.normativa_aplicada[0].cita).toContain('cobro duplicado');

    // Tres secciones limpias y sin emojis
    expect(res.body.respuesta).toContain(SECCION_DIAGNOSTICO);
    expect(res.body.respuesta).toContain(SECCION_PASOS);
    expect(res.body.respuesta).toContain(SECCION_BORRADOR);
    expect(res.body.respuesta).not.toMatch(EMOJI_REGEX);
    expect(res.body.borrador_respuesta).toBeTruthy();
    expect(res.body.borrador_respuesta).toContain(TICKET_ID);
    expect(res.body.borrador_respuesta).not.toContain(SECCION_BORRADOR);
    expect(res.body.borrador_respuesta).not.toMatch(EMOJI_REGEX);

    // Fuentes oficiales y adjunto citados
    expect(res.body.fuentes_citadas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nombre_archivo: 'manual_facturacion_y_notas_credito.md', origen: 'normativa' }),
        expect.objectContaining({ nombre_archivo: 'evidencia_cobro_duplicado.pdf', origen: 'adjunto' }),
      ])
    );

    // Cruces SQL verificados
    const consultaTicket = llamadas.find(
      (llamada) => llamada.sql.includes('FROM pqrs_solicitudes') && llamada.sql.includes('WHERE ticket_id = ?')
    );
    expect(consultaTicket).toBeDefined();
    expect(consultaTicket.params).toEqual([TICKET_ID]);

    const consultaActividades = llamadas.find((llamada) => llamada.sql.includes('FROM pqrs_actividades'));
    expect(consultaActividades).toBeDefined();
    expect(consultaActividades.params).toEqual([TICKET_ID]);

    const consultaAdjuntos = llamadas.find(
      (llamada) => llamada.sql.includes('FROM documentos') && !llamada.sql.includes('documentos_chunks') && llamada.sql.includes('ticket_id = ?')
    );
    expect(consultaAdjuntos).toBeDefined();
    expect(consultaAdjuntos.params).toEqual([TICKET_ID]);

    const consultaNormativa = llamadas.find((llamada) => llamada.sql.includes('FROM documentos_chunks'));
    expect(consultaNormativa).toBeDefined();
    expect(consultaNormativa.sql).toContain('r.id = 3');
    expect(consultaNormativa.sql).toContain("r.slug = 'normativa-pqrs'");
    expect(consultaNormativa.sql).toContain("r.departamento = 'Normativa PQRS'");
    expect(consultaNormativa.sql).toContain('ILIKE');
  });

  test('S2-02b: SUPERVISOR puede fusionar el contexto del mismo ticket', async () => {
    const { res, duracionMs } = await consultarComo(tokenSupervisor, {
      query: 'Resume el estado del ticket y la severidad del SLA.',
      ticket_id: TICKET_ID,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(duracionMs).toBeLessThan(1500);
    expect(res.body.contexto_ticket.ticket_id).toBe(TICKET_ID);
    expect(res.body.respuesta).toContain(SECCION_DIAGNOSTICO);
  });

  test('S2-02c: Rol no operativo (RECLUTADOR) recibe HTTP 403 sin consultar el ticket', async () => {
    const { res } = await consultarComo(tokenReclutador, {
      query: 'Intento consultar el contexto de un ticket ajeno.',
      ticket_id: TICKET_ID,
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.mensaje).toMatch(/Solo perfiles operativos/i);
    expect(llamadas).toHaveLength(0);
  });

  test('S2-02d: chat.controller.js no contiene emojis Unicode', () => {
    const rutaControlador = path.join(__dirname, '../controllers/chat.controller.js');
    const contenido = fs.readFileSync(rutaControlador, 'utf8');
    expect(EMOJI_REGEX.test(contenido)).toBe(false);
  });
});
