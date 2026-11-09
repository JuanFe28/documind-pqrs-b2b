import { Router } from 'express';
import multer from 'multer';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  consultarRAG,
  consultarChatConImagen,
  listarThreads,
  crearThread,
  listarMensajes,
  eliminarThread,
} from '../controllers/chat.controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Directorio temporal de subida para el chatbot
const uploadsDir = join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `chat-vision-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

router.use(authMiddleware);

// Endpoint de RAG tradicional
router.post('/query', consultarRAG);

// Endpoint Multimodal: Análisis visual e interactivo de imágenes/formularios desde el Chat
router.post('/multimodal', upload.single('archivo'), consultarChatConImagen);
// Alias exigido por la guía del Tercer Corte para conservar trazabilidad de la imagen
router.post('/con-imagen', upload.single('archivo'), consultarChatConImagen);

// Endpoints de Historial de Chat
router.get('/threads', listarThreads);
router.post('/threads', crearThread);
router.get('/threads/:threadId/messages', listarMensajes);
router.delete('/threads/:threadId', eliminarThread);

export default router;
