import {
  radicarSolicitudNativa,
  consultarWorkspaceNativo,
  trackingTicketNativo,
  actualizarTicketNativo,
  calificarTicketNativo,
  consultarLogsEjecuciones,
} from '../services/automation.service.js';

/**
 * F01: POST /api/pqrs/radicar y POST /webhook/radicar-pqrs
 */
export async function radicarPqrsController(req, res) {
  try {
    const actor = req.user?.email || req.ip || 'PORTAL_PUBLICO';
    const resultado = await radicarSolicitudNativa(req.body, actor);
    return res.status(resultado.codigo_http || 201).json(resultado);
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      status: 'error',
      mensaje: error.message || 'Error al radicar solicitud PQRS',
    });
  }
}

/**
 * F02: GET /api/pqrs/consultar y GET /webhook/consultar-pqrs
 */
export async function consultarPqrsController(req, res) {
  try {
    const actor = req.user?.email || req.headers['authorization'] || 'AGENTE_OPERATIVO';
    const resultado = await consultarWorkspaceNativo(actor);
    return res.status(200).json(resultado);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      mensaje: error.message || 'Error al consultar tickets y métricas',
    });
  }
}

/**
 * F03: GET /api/pqrs/:ticketId/tracking y GET /webhook/consultar-ticket
 */
export async function trackingPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.query?.id;
    const token = req.query?.token || req.body?.tracking_token || req.body?.token;
    const actor = req.user?.email || req.ip || 'CIUDADANO';

    if (!ticketId || !token) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Se requiere radicado (id) y clave privada (token).',
      });
    }

    const resultado = await trackingTicketNativo(ticketId, token, actor);
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      mensaje: error.message || 'Error en consulta de seguimiento',
    });
  }
}

/**
 * F04: PUT /api/pqrs/:ticketId/actualizar y POST /webhook/actualizar-ticket
 */
export async function actualizarPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const actor = req.user?.email || req.body?.agente_nombre || 'AGENTE';
    const payload = {
      ...req.body,
      ticket_id: ticketId,
    };

    const resultado = await actualizarTicketNativo(payload, actor);
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      status: 'error',
      mensaje: error.message || 'Error al actualizar ticket',
    });
  }
}

/**
 * F05: POST /api/pqrs/:ticketId/calificar y POST /webhook/calificar-ticket
 */
export async function calificarPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const token = req.body?.token || req.body?.tracking_token;
    const puntuacion = req.body?.puntuacion ?? req.body?.score;
    const retroalimentacion = req.body?.retroalimentacion || req.body?.comentario || '';
    const actor = req.user?.email || req.ip || 'CIUDADANO';

    const resultado = await calificarTicketNativo(ticketId, token, puntuacion, retroalimentacion, actor);
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    const status = error.statusCode || (error.code === 'ECONNREFUSED' || error.message.includes('connect') ? 500 : 400);
    return res.status(status).json({
      status: 'error',
      mensaje: error.message || 'Error al calificar ticket',
    });
  }
}

/**
 * Consulta de Logs de Auditoría del Motor en Código
 * GET /api/pqrs/logs
 */
export async function obtenerLogsController(req, res) {
  try {
    const { flujo, estado, limit = 50, page = 1 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const resultado = await consultarLogsEjecuciones({ flujo, estado, limit, offset });
    return res.status(200).json({
      status: 'success',
      data: resultado.logs,
      pagination: {
        total: resultado.total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      mensaje: error.message || 'Error al consultar logs de ejecución',
    });
  }
}
