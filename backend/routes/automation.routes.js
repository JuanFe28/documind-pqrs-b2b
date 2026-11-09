import { Router } from 'express';
import {
  radicarPqrsController,
  consultarPqrsController,
  trackingPqrsController,
  actualizarPqrsController,
  calificarPqrsController,
  alertasSlaController,
  reporteSemanalController,
  cerrarCsatController,
  escalarN2Controller,
  obtenerLogsController,
} from '../controllers/automation.controller.js';
import {
  verificarToken,
  verificarTokenOpcional,
  requireRol,
} from '../middleware/auth.middleware.js';

const router = Router();

const ROLES_AUTOMATIZACION = ['ADMIN', 'SUPERVISOR', 'AGENTE'];

// ─── Flujos nativos del motor de automatización (Ruta A) ─────────────────────
router.post('/radicar', radicarPqrsController);
router.get('/consultar', verificarTokenOpcional, consultarPqrsController);
router.get('/tickets/:ticketId/tracking', verificarTokenOpcional, trackingPqrsController);
router.put('/tickets/:ticketId/actualizar', verificarTokenOpcional, actualizarPqrsController);
router.post('/tickets/:ticketId/calificar', calificarPqrsController);

// ─── F02: Alertas de SLA < 4 horas y vencidas ────────────────────────────────
router.get('/alertas-sla', verificarToken, requireRol(...ROLES_AUTOMATIZACION), alertasSlaController);
router.post('/alertas-sla', verificarToken, requireRol(...ROLES_AUTOMATIZACION), alertasSlaController);

// ─── F03: Reporte semanal consolidado ────────────────────────────────────────
router.get('/reporte-semanal', verificarToken, requireRol(...ROLES_AUTOMATIZACION), reporteSemanalController);
router.post('/reporte-semanal', verificarToken, requireRol(...ROLES_AUTOMATIZACION), reporteSemanalController);

// ─── F04: Cierre formal con encuesta CSAT ────────────────────────────────────
router.post('/tickets/:ticketId/cerrar-csat', verificarToken, requireRol(...ROLES_AUTOMATIZACION), cerrarCsatController);

// ─── F05: Escalamiento a Nivel 2 (Crítica/Alta) ──────────────────────────────
router.post('/tickets/:ticketId/escalar-n2', verificarToken, requireRol(...ROLES_AUTOMATIZACION), escalarN2Controller);

// ─── Auditoría de ejecuciones ────────────────────────────────────────────────
router.get('/logs', verificarToken, requireRol('ADMIN', 'SUPERVISOR'), obtenerLogsController);

export default router;
