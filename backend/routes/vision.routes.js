import { Router } from 'express';
import multer from 'multer';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { procesarFormularioController } from '../controllers/vision.controller.js';
import { verificarTokenOpcional } from '../middleware/auth.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Directorio temporal de carga
const uploadsDir = join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `vision-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const permitidos = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (permitidos.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Formato no soportado. Se admiten únicamente imágenes (.jpg, .png, .webp) o documentos .pdf'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// Endpoint de procesamiento de formularios físicos con Visión IA
router.post('/procesar-formulario', verificarTokenOpcional, upload.single('archivo'), procesarFormularioController);

export default router;

