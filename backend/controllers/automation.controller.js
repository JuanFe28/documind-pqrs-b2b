import {
  radicarSolicitudNativa,
  consultarWorkspaceNativo,
  trackingTicketNativo,
  actualizarTicketNativo,
  calificarTicketNativo,
  procesarAlertasSla,
  generarReporteSemanal,
  cerrarTicketConEncuestaCSAT,
  escalarTicketNivel2,
  consultarLogsEjecuciones,
} from '../services/automation.service.js';

/**
 * Resuelve el actor responsable de la operación sin exponer credenciales en claro.
 * Nunca retorna el valor crudo del header Authorization.
 */
export function obtenerActor(req) {
  if (req?.user?.email) return req.user.email;
  if (req?.user?.nombre) return req.user.nombre;
  if (req?.user?.id !== undefined && req?.user?.id !== null) return `USUARIO_${req.user.id}`;
  if (req?.headers?.authorization) return 'API_CLIENT_AUTENTICADO';
  return null;
}

/**
 * F01: POST /api/pqrs/radicar y POST /webhook/radicar-pqrs
 */
export async function radicarPqrsController(req, res) {
  try {
    const actor = obtenerActor(req) || req.ip || 'PORTAL_PUBLICO';
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
 * F06 (auxiliar): GET /api/pqrs/consultar y GET /webhook/consultar-pqrs
 */
export async function consultarPqrsController(req, res) {
  try {
    const actor = obtenerActor(req) || req.ip || 'AGENTE_OPERATIVO';
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
 * F07 (auxiliar): GET /api/pqrs/:ticketId/tracking y GET /webhook/consultar-ticket
 */
export async function trackingPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.query?.id;
    const token = req.query?.token || req.body?.tracking_token || req.body?.token;
    const actor = obtenerActor(req) || req.ip || 'CIUDADANO';

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
 * F08 (auxiliar): PUT /api/pqrs/:ticketId/actualizar y POST /webhook/actualizar-ticket
 */
export async function actualizarPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const actor = obtenerActor(req) || req.body?.agente_nombre || 'AGENTE';
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
 * F09 (auxiliar): POST /api/pqrs/:ticketId/calificar y POST /webhook/calificar-ticket
 */
export async function calificarPqrsController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const token = req.body?.token || req.body?.tracking_token;
    const puntuacion = req.body?.puntuacion ?? req.body?.score;
    const retroalimentacion = req.body?.retroalimentacion || req.body?.comentario || '';
    const actor = obtenerActor(req) || req.ip || 'CIUDADANO';

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
 * F02: Alertas automáticas de SLA próximas a vencer y vencidas.
 * GET/POST /api/automation/alertas-sla
 */
export async function alertasSlaController(req, res) {
  try {
    const actor = obtenerActor(req) || req.ip || 'MOTOR_AUTOMATIZACION';
    const umbralHoras = req.query?.umbral_horas ?? req.body?.umbral_horas ?? 4;
    const resultado = await procesarAlertasSla({ umbralHoras, actor });
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      mensaje: error.message || 'Error al procesar alertas de SLA',
    });
  }
}

/**
 * F03: Reporte semanal consolidado.
 * GET/POST /api/automation/reporte-semanal
 */
export async function reporteSemanalController(req, res) {
  try {
    const actor = obtenerActor(req) || req.ip || 'MOTOR_AUTOMATIZACION';
    const { desde, hasta, destinatario } = req.body || {};
    const resultado = await generarReporteSemanal({
      desde: desde || req.query?.desde,
      hasta: hasta || req.query?.hasta,
      destinatario,
      actor,
    });
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      mensaje: error.message || 'Error al generar reporte semanal',
    });
  }
}

/**
 * F04: Cierre formal con encuesta CSAT.
 * POST /api/automation/tickets/:ticketId/cerrar-csat
 */
export async function cerrarCsatController(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const actor = obtenerActor(req) || req.body?.agente_nombre || 'AGENTE';
    const resultado = await cerrarTicketConEncuestaCSAT(
      { ...req.body, ticket_id: ticketId },
      actor
    );
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      mensaje: error.message || 'Error al cerrar el radicado con encuesta CSAT',
    });
  }
}

/**
 * F05: Escalamiento a Nivel 2 para prioridad Crítica/Alta.
 * POST /api/automation/tickets/:ticketId/escalar-n2
 */
export async function escalarN2Controller(req, res) {
  try {
    const ticketId = req.params?.ticketId || req.body?.ticket_id;
    const actor = obtenerActor(req) || req.body?.agente_nombre || 'SISTEMA';
    const resultado = await escalarTicketNivel2(
      { ...req.body, ticket_id: ticketId },
      actor
    );
    return res.status(resultado.codigo || 200).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      mensaje: error.message || 'Error al escalar el radicado a Nivel 2',
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
