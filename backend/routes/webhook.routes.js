import { Router } from 'express';
import {
  radicarPqrsController,
  consultarPqrsController,
  trackingPqrsController,
  actualizarPqrsController,
  calificarPqrsController,
} from '../controllers/automation.controller.js';

const router = Router();

/**
 * Endpoints nativos en Express que reemplazan el 100% de los webhooks de n8n (Ruta A).
 * Permiten que clientes antiguos y modernos (index.html, React, curl, pruebas) funcionen sin n8n.
 */
router.post('/radicar-pqrs', radicarPqrsController);
router.get('/consultar-pqrs', consultarPqrsController);
router.get('/consultar-ticket', trackingPqrsController);
router.post('/actualizar-ticket', actualizarPqrsController);
router.post('/calificar-ticket', calificarPqrsController);

export default router;
