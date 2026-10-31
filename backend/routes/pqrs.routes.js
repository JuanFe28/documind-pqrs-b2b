import { Router } from 'express';
import {
  listarPqrs,
  obtenerPqrsDetalle,
  actualizarEstadoPqrs,
  obtenerKpisPqrs,
  consultarPqrsPrivado,
  descargarDocumentoCiudadano,
} from '../controllers/pqrs.controller.js';
import {
  radicarPqrsController,
  consultarPqrsController,
  trackingPqrsController,
  actualizarPqrsController,
  calificarPqrsController,
  obtenerLogsController,
} from '../controllers/automation.controller.js';
import { verificarToken, verificarTokenOpcional, requireRol } from '../middleware/auth.middleware.js';

const router = Router();

// Roles internos autorizados para la gestión y métricas de soporte
const ROLES_INTERNOS_PQRS = ['ADMIN', 'AGENTE', 'SUPERVISOR', 'LEGAL', 'FINANCIERO', 'RECLUTADOR'];

// ─── Motor de Automatización Propio en Código (Ruta A) ────────────────────────
router.post('/radicar', radicarPqrsController);
router.get('/consultar', verificarTokenOpcional, consultarPqrsController);
router.get('/logs', verificarToken, requireRol('ADMIN', 'SUPERVISOR'), obtenerLogsController);
router.put('/:ticketId/actualizar', verificarTokenOpcional, actualizarPqrsController);
router.post('/:ticketId/calificar', calificarPqrsController);

// Endpoints administrativos protegidos (requieren autenticación de funcionario)
router.get('/', verificarToken, requireRol(...ROLES_INTERNOS_PQRS), listarPqrs);
router.get('/kpis', verificarToken, requireRol(...ROLES_INTERNOS_PQRS), obtenerKpisPqrs);

// Endpoints ciudadanos de radicación, seguimiento y descarga protegida
router.get('/:ticketId', verificarTokenOpcional, obtenerPqrsDetalle);
router.post('/:ticketId/tracking', consultarPqrsPrivado);
router.get('/:ticketId/documentos/:documentId', descargarDocumentoCiudadano);
router.post('/:ticketId/documentos/:documentId/descargar', descargarDocumentoCiudadano);
router.put('/:ticketId/estado', verificarToken, actualizarEstadoPqrs);

export default router;

