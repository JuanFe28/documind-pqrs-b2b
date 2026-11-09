import crypto from 'crypto';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { procesarFormularioConVision } from '../services/vision.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const uploadsDir = path.resolve(__dirname, '../uploads');
const registroAccesoPath = path.join(uploadsDir, 'registro_acceso_vision.json');

export function registrarAccesoVision(metadatos) {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    let registros = [];
    if (fs.existsSync(registroAccesoPath)) {
      const contenido = fs.readFileSync(registroAccesoPath, 'utf8');
      if (contenido.trim()) {
        const parseado = JSON.parse(contenido);
        registros = Array.isArray(parseado) ? parseado : [];
      }
    }
    registros.push(metadatos);
    fs.writeFileSync(registroAccesoPath, JSON.stringify(registros, null, 2), 'utf8');
  } catch (error) {
    console.error('[Vision Controller] No se pudo actualizar el registro de auditoría:', error.message);
  }
}

/**
 * POST /api/vision/procesar-formulario
 * Carga una imagen o PDF de un formulario físico o evidencia de novedad
 * y la procesa con IA multimodal extrayendo JSON estructurado con confianza.
 */
export async function procesarFormularioController(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        status: 'error',
        mensaje: 'Debe adjuntar una imagen (JPG, PNG, WebP) o PDF del formulario.',
      });
    }

    const file = req.file;
    const usuarioId = req.user?.email || req.user?.nombre || 'AGENTE_OPERATIVO';

    // Leer el buffer del archivo cargado
    const fileBuffer = fs.readFileSync(file.path);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const resultado = await procesarFormularioConVision(
      fileBuffer,
      file.mimetype,
      file.originalname,
      usuarioId
    );

    registrarAccesoVision({
      archivo: file.filename,
      nombre_original: file.originalname,
      sha256,
      subido_por: usuarioId,
      rol: req.user?.rol || 'ANONIMO',
      fecha_subida: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      status: 'success',
      archivo: {
        nombre: file.originalname,
        tamano_bytes: file.size,
        mimetype: file.mimetype,
        sha256,
        url_protegida: `/api/vision/archivos/${file.filename}`,
      },
      ...resultado,
    });
  } catch (error) {
    console.error('[Vision Controller] Error al procesar imagen:', error.message);
    return res.status(500).json({
      ok: false,
      status: 'error',
      mensaje: `Error al procesar formulario con visión: ${error.message}`,
    });
  }
}

/**
 * GET /api/vision/archivos/:filename
 * Entrega de forma protegida una imagen previamente procesada y conservada en /uploads.
 */
export function descargarArchivoVisionController(req, res) {
  try {
    const filename = String(req.params.filename || '');

    if (!filename || filename !== path.basename(filename) || filename.includes('\0')) {
      return res.status(400).json({ ok: false, mensaje: 'Nombre de archivo inválido.' });
    }

    const rutaSolicitada = path.resolve(uploadsDir, filename);
    const rutaRelativa = path.relative(uploadsDir, rutaSolicitada);

    if (rutaRelativa.startsWith('..') || path.isAbsolute(rutaRelativa)) {
      return res.status(403).json({ ok: false, mensaje: 'Acceso al archivo no permitido.' });
    }

    if (!fs.existsSync(rutaSolicitada) || !fs.statSync(rutaSolicitada).isFile()) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo no encontrado.' });
    }

    const mimePorExtension = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    };
    const extension = path.extname(rutaSolicitada).toLowerCase();
    const contentType = mimePorExtension[extension] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(rutaSolicitada);
  } catch (error) {
    console.error('[Vision Controller] Error al entregar archivo protegido:', error.message);
    return res.status(500).json({
      ok: false,
      mensaje: `Error al recuperar el archivo: ${error.message}`,
    });
  }
}

