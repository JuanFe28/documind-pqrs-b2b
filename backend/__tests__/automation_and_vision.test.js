import request from 'supertest';
import app from '../app.js';
import crypto from 'crypto';
import {
  evaluarSla,
  clasificarDepartamento,
  radicarSolicitudNativa,
  trackingTicketNativo,
  actualizarTicketNativo,
  calificarTicketNativo,
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
  });

});
