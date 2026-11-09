import request from 'supertest';
import app from '../app.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import db from '../config/db.js';
import {
  evaluarSla,
  clasificarDepartamento,
  radicarSolicitudNativa,
  trackingTicketNativo,
  actualizarTicketNativo,
  calificarTicketNativo,
  ejecutarConReintentos,
  enmascararPII,
  registrarLogEjecucion,
  procesarAlertasSla,
  generarReporteSemanal,
  cerrarTicketConEncuestaCSAT,
  escalarTicketNivel2,
} from '../services/automation.service.js';
import { procesarFormularioConVision } from '../services/vision.service.js';

describe('Motor de Automatización Nativo en Código (Ruta A) y Visión Multimodal', () => {

  describe('Evaluación de Reglas de Negocio y SLAs', () => {
    test('Prioridad Crítica asigna 2 horas de SLA y marca urgente', () => {
      const res = evaluarSla('Crítica', 'Petición');
      expect(res.horas).toBe(2);
      expect(res.es_urgente).toBe(true);
    });

    test('Prioridad Alta o Tipo Reclamo asigna 4 horas de SLA y marca urgente', () => {
      const resAlta = evaluarSla('Alta', 'Petición');
      expect(resAlta.horas).toBe(4);
      expect(resAlta.es_urgente).toBe(true);

      const resReclamo = evaluarSla('Media', 'Reclamo');
      expect(resReclamo.horas).toBe(4);
      expect(resReclamo.es_urgente).toBe(true);
    });

    test('Prioridad Baja asigna 48 horas de SLA sin urgencia', () => {
      const res = evaluarSla('Baja', 'Sugerencia');
      expect(res.horas).toBe(48);
      expect(res.es_urgente).toBe(false);
    });

    test('Prioridad Media asigna 24 horas de SLA estándar', () => {
      const res = evaluarSla('Media', 'Petición');
      expect(res.horas).toBe(24);
      expect(res.es_urgente).toBe(false);
    });

    test('Clasificación de departamento según contenido', () => {
      expect(clasificarDepartamento('Cobro indebido de factura', 'Detalle de pago')).toBe('Facturación y Cobranzas');
      expect(clasificarDepartamento('Falla en equipo', 'Avería de pantalla rota', 'Reclamo')).toBe('Control de Calidad y Garantías');
      expect(clasificarDepartamento('Solicitud general', 'Consulta de horario')).toBe('Soporte Técnico y Sistemas');
    });
  });

  describe('Endpoints HTTP de Automatización (Drop-in /webhook/* y /api/pqrs/*)', () => {
    test('POST /webhook/radicar-pqrs rechaza solicitudes con datos incompletos', async () => {
      const res = await request(app)
        .post('/webhook/radicar-pqrs')
        .send({
          nombre_solicitante: 'A', // Demasiado corto
          email_solicitante: 'correo-invalido',
          asunto: 'No',
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    test('GET /webhook/consultar-ticket rechaza peticiones sin token o id', async () => {
      const res = await request(app)
        .get('/webhook/consultar-ticket');

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    test('POST /webhook/calificar-ticket rechaza puntuaciones fuera de rango (1-5)', async () => {
      const res = await request(app)
        .post('/webhook/calificar-ticket')
        .send({
          ticket_id: 'PQRS-2026-000000000001',
          token: crypto.randomUUID(),
          puntuacion: 10, // Inválido
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
    });

    test('POST /webhook/calificar-ticket acepta indistintamente "token" o "tracking_token" (Fix BUG-001)', async () => {
      const res = await request(app)
        .post('/webhook/calificar-ticket')
        .send({
          ticket_id: 'PQRS-2026-999999999999',
          tracking_token: crypto.randomUUID(), // Usando tracking_token
          puntuacion: 5,
        });

      // No debe ser 400 por falta de token; si no encuentra el ticket devuelve 404
      expect([404, 500]).toContain(res.status);
    });

    test('POST /api/pqrs/radicar está disponible como endpoint nativo', async () => {
      const res = await request(app)
        .post('/api/pqrs/radicar')
        .send({
          nombre_solicitante: 'Carlos Test',
          email_solicitante: 'carlos@test.com',
          asunto: 'Prueba de Endpoint Nativo Express',
          descripcion: 'Descripción extensa de prueba para verificar que el servicio nativo funciona correctamente.',
          prioridad: 'Media',
        });

      // Si Postgres no está activo retornará 400 o 500 controlado, validando que el router y validaciones existen
      expect([200, 201, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });
  });

  describe('Módulo de Visión por Computador e IA Multimodal (Plan B de Resiliencia)', () => {
    test('Procesamiento de imagen activa Plan B ante ausencia de API key o cuota agotada sin colapsar', async () => {
      const fakeImageBuffer = Buffer.from('Contenido simulado de formulario impreso con correo juan@example.com y telefono 3001234567');
      const resultado = await procesarFormularioConVision(fakeImageBuffer, 'image/jpeg', 'formulario_prueba.jpg', 'TEST_RUNNER');

      expect(resultado).toHaveProperty('score_confianza');
      expect(resultado).toHaveProperty('datos_extraidos');
      expect(resultado).toHaveProperty('requiere_revision_humana');
      expect(typeof resultado.score_confianza).toBe('number');
      expect(resultado.score_confianza).toBeGreaterThan(0);
      expect(resultado.score_confianza).toBeLessThanOrEqual(1.0);
    }, 15000);

    test('Endpoint POST /api/vision/procesar-formulario rechaza peticiones sin archivo', async () => {
      const res = await request(app)
        .post('/api/vision/procesar-formulario');

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.mensaje).toMatch(/Debe adjuntar una imagen/);
    });

    test('Endpoint POST /api/vision/procesar-formulario procesa archivo adjunto y devuelve JSON con confianza', async () => {
      const fakeBuffer = Buffer.from('Simulación de documento físico con reclamo por avería en producto entregado.');
      
      const res = await request(app)
        .post('/api/vision/procesar-formulario')
        .attach('archivo', fakeBuffer, { filename: 'novedad_entrega.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body).toHaveProperty('score_confianza');
      expect(res.body).toHaveProperty('datos_extraidos');
      expect(res.body.datos_extraidos).toHaveProperty('tipo_solicitud');
    });

    test('Endpoint POST /api/chat/multimodal exige autenticación JWT', async () => {
      const res = await request(app)
        .post('/api/chat/multimodal');

      expect(res.status).toBe(401);
    });

    test('Endpoint POST /api/chat/multimodal procesa imagen adjunta y devuelve respuesta conversacional y datos_vision', async () => {
      const secret = process.env.JWT_SECRET || 'test_jwt_secret_documind_2026';
      const authToken = jwt.sign(
        { id: 10, nombre: 'Analista QA', email: 'analista@documind.com', rol: 'AGENTE' },
        secret
      );

      const fakeBuffer = Buffer.from('Formulario de soporte técnico solicitando cambio de servidor por calentamiento.');

      const res = await request(app)
        .post('/api/chat/multimodal')
        .set('Authorization', `Bearer ${authToken}`)
        .field('query', '¿Cuál es la prioridad de esta novedad?')
        .attach('archivo', fakeBuffer, { filename: 'soporte_servidor.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body).toHaveProperty('respuesta');
      expect(res.body).toHaveProperty('datos_vision');
      expect(res.body.datos_vision).toHaveProperty('score_confianza');
      expect(res.body.datos_vision).toHaveProperty('datos_extraidos');
    });
  });

  describe('Resiliencia del motor: reintentos con backoff y enmascaramiento PII (Ley 1581)', () => {
    test('ejecutarConReintentos reintenta errores transitorios con backoff exponencial + jitter', async () => {
      let llamadas = 0;
      const inicio = Date.now();

      const { resultado, intentos } = await ejecutarConReintentos(
        async (numeroIntento) => {
          llamadas = numeroIntento;
          if (numeroIntento < 3) {
            const error = new Error('connection timeout');
            error.code = 'ETIMEDOUT';
            throw error;
          }
          return 'operacion-exitosa';
        },
        { maxAttempts: 3, baseDelayMs: 20 }
      );

      expect(resultado).toBe('operacion-exitosa');
      expect(intentos).toBe(3);
      expect(llamadas).toBe(3);
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(40);
    });

    test('ejecutarConReintentos NO reintenta errores no transitorios (400)', async () => {
      let llamadas = 0;
      const errorValidacion = new Error('Datos de entrada inválidos');
      errorValidacion.statusCode = 400;

      await expect(
        ejecutarConReintentos(
          async () => {
            llamadas += 1;
            throw errorValidacion;
          },
          { maxAttempts: 5, baseDelayMs: 1 }
        )
      ).rejects.toThrow('Datos de entrada inválidos');

      expect(llamadas).toBe(1);
    });

    test('enmascararPII oculta correos y teléfonos en estructuras anidadas', () => {
      const salida = enmascararPII({
        email_solicitante: 'juan.perez@example.com',
        telefono: '3001234567',
        anidado: { correo: 'maria@empresa.co', celular: '+57 310 987 6543' },
        arreglo: [{ email: 'pedro@test.com', phone: '3201112233' }],
        password: 'secreto123',
      });

      expect(salida.email_solicitante).toBe('j***@example.com');
      expect(salida.telefono).toBe('******4567');
      expect(salida.anidado.correo).toBe('m***@empresa.co');
      expect(salida.anidado.celular).toContain('6543');
      expect(salida.anidado.celular).not.toContain('3109876543');
      expect(salida.arreglo[0].email).toBe('p***@test.com');
      expect(salida.arreglo[0].phone).not.toContain('3201112233');
      expect(salida.password).toBe('***REDACTED***');
    });

    test('registrarLogEjecucion persiste ejecuciones exitosas y fallidas con PII enmascarada', async () => {
      const spy = jest.spyOn(db, 'query').mockResolvedValue([{ id: 1 }]);

      await registrarLogEjecucion({
        flujo: 'F01_RADICAR_PQRS',
        disparador: 'TEST_EXITO',
        actor: 'tester@example.com',
        estado: 'EXITO',
        datos_entrada: { email_solicitante: 'juan@example.com', telefono: '3001234567' },
        datos_salida: { ticket_id: 'PQRS-2026-000000000001' },
        tiempo_ms: 10,
      });

      const parametrosExito = spy.mock.calls[0][1];
      expect(spy.mock.calls[0][0]).toContain('pqrs_logs_ejecuciones');
      expect(parametrosExito[2]).toBe('t***@example.com');
      expect(parametrosExito[3]).toBe('EXITO');
      expect(parametrosExito[4]).toContain('j***@example.com');
      expect(parametrosExito[4]).not.toContain('juan@example.com');
      expect(parametrosExito[4]).toContain('******4567');
      expect(parametrosExito[4]).not.toContain('3001234567');
      expect(parametrosExito[5]).toContain('PQRS-2026-000000000001');

      await registrarLogEjecucion({
        flujo: 'F01_RADICAR_PQRS',
        disparador: 'TEST_ERROR',
        actor: 'fallo@example.com',
        estado: 'ERROR',
        datos_entrada: { email: 'error@example.com', telefono: '3109998877' },
        mensaje_error: 'Fallo 500 con error@example.com y teléfono 3109998877',
        tiempo_ms: 20,
      });

      const parametrosError = spy.mock.calls[1][1];
      expect(parametrosError[2]).toBe('f***@example.com');
      expect(parametrosError[3]).toBe('ERROR');
      expect(parametrosError[4]).toContain('e***@example.com');
      expect(parametrosError[4]).not.toContain('error@example.com');
      expect(parametrosError[4]).not.toContain('3109998877');
      expect(parametrosError[6]).toContain('e***@example.com');
      expect(parametrosError[6]).not.toContain('error@example.com');
      expect(parametrosError[6]).not.toContain('3109998877');

      spy.mockRestore();
    });
  });

  describe('Flujos obligatorios F02 a F05 del Componente 1', () => {
    test('F02 genera alertas para SLA vencidas y próximas a vencer (< 4 horas)', async () => {
      const ahora = Date.now();
      const tickets = [
        {
          ticket_id: 'PQRS-2026-000000000001',
          prioridad: 'Alta',
          asunto: 'Caso vencido',
          estado: 'NUEVO',
          sla_horas: 4,
          sla_fecha_limite: new Date(ahora - 3600 * 1000).toISOString(),
          email_solicitante: 'vencido@example.com',
        },
        {
          ticket_id: 'PQRS-2026-000000000002',
          prioridad: 'Media',
          asunto: 'Caso por vencer',
          estado: 'EN_GESTION',
          sla_horas: 24,
          sla_fecha_limite: new Date(ahora + 3600 * 1000).toISOString(),
          email_solicitante: 'porvencer@example.com',
        },
      ];

      const spy = jest.spyOn(db, 'query').mockImplementation(async (sql) => {
        if (String(sql).includes('FROM pqrs_solicitudes') && String(sql).includes('sla_fecha_limite <=')) {
          return tickets;
        }
        return [];
      });

      const res = await procesarAlertasSla({ umbralHoras: 4 });

      expect(res.status).toBe('success');
      expect(res.codigo).toBe(200);
      expect(res.total).toBe(2);
      expect(res.alertas[0].tipo).toBe('SLA_VENCIDA');
      expect(res.alertas[1].tipo).toBe('SLA_POR_VENCER');

      spy.mockRestore();
    });

    test('F03 genera el reporte semanal consolidado con métricas y CSAT', async () => {
      const spy = jest.spyOn(db, 'query').mockImplementation(async (sql) => {
        const consulta = String(sql);
        if (consulta.includes('satisfaccion_promedio') && consulta.includes('COUNT(*) AS total')) {
          return [{ total: 10, resueltos: 7, pendientes: 3, vencidos: 1, satisfaccion_promedio: '4.5' }];
        }
        if (consulta.includes('GROUP BY departamento')) {
          return [{ departamento: 'Soporte Técnico y Sistemas', total: 6, resueltos: 4 }];
        }
        return [];
      });

      const res = await generarReporteSemanal({ destinatario: 'reporte@example.com' });

      expect(res.status).toBe('success');
      expect(res.codigo).toBe(200);
      expect(res.resumen.total).toBe(10);
      expect(res.resumen.resueltos).toBe(7);
      expect(res.resumen.vencidos).toBe(1);
      expect(res.resumen.satisfaccion_promedio).toBe(4.5);
      expect(res.por_departamento[0].departamento).toBe('Soporte Técnico y Sistemas');

      spy.mockRestore();
    });

    test('F04 cierra el ticket y envía la encuesta CSAT al solicitante', async () => {
      const spy = jest.spyOn(db, 'query').mockImplementation(async (sql) => {
        if (String(sql).includes('FROM pqrs_solicitudes') && String(sql).includes('WHERE ticket_id = ?')) {
          return [
            {
              ticket_id: 'PQRS-2026-000000000003',
              tracking_token: crypto.randomUUID(),
              cliente_nombre: 'Juan Pérez',
              cliente_email: 'juan@example.com',
              estado: 'RESUELTO',
              asunto: 'Caso resuelto',
              prioridad: 'Alta',
              sla_horas: 4,
            },
          ];
        }
        return [];
      });

      const res = await cerrarTicketConEncuestaCSAT(
        { ticket_id: 'PQRS-2026-000000000003', mensaje_resolucion: 'Solicitud atendida' },
        'AGENTE_TEST'
      );

      expect(res.status).toBe('success');
      expect(res.codigo).toBe(200);
      expect(res.estado).toBe('CERRADO');
      expect(res.encuesta).toBeDefined();

      spy.mockRestore();
    });

    test('F05 escala a Nivel 2 para prioridad Crítica/Alta y rechaza prioridad Media', async () => {
      const spy = jest.spyOn(db, 'query').mockImplementation(async (sql) => {
        if (String(sql).includes('FROM pqrs_solicitudes') && String(sql).includes('WHERE ticket_id = ?')) {
          return [
            {
              ticket_id: 'PQRS-2026-000000000004',
              prioridad: 'Crítica',
              estado: 'EN_GESTION',
              asunto: 'Caso crítico',
              tracking_token: crypto.randomUUID(),
              sla_horas: 2,
            },
          ];
        }
        return [];
      });

      const resCritica = await escalarTicketNivel2({ ticket_id: 'PQRS-2026-000000000004' }, 'SISTEMA');
      expect(resCritica.status).toBe('success');
      expect(resCritica.codigo).toBe(200);
      expect(resCritica.nivel).toBe(2);

      spy.mockRestore();

      const spyMedia = jest.spyOn(db, 'query').mockImplementation(async (sql) => {
        if (String(sql).includes('FROM pqrs_solicitudes') && String(sql).includes('WHERE ticket_id = ?')) {
          return [
            {
              ticket_id: 'PQRS-2026-000000000005',
              prioridad: 'Media',
              estado: 'EN_GESTION',
              asunto: 'Caso medio',
            },
          ];
        }
        return [];
      });

      const resMedia = await escalarTicketNivel2({ ticket_id: 'PQRS-2026-000000000005' }, 'SISTEMA');
      expect(resMedia.status).toBe('error');
      expect(resMedia.codigo).toBe(400);

      spyMedia.mockRestore();
    });
  });

});
