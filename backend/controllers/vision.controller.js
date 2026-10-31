import fs from 'fs';
import path from 'path';
import { procesarFormularioConVision } from '../services/vision.service.js';

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
    const resultado = await procesarFormularioConVision(
      fileBuffer,
      file.mimetype,
      file.originalname,
      usuarioId
    );

    return res.status(200).json({
      ok: true,
      status: 'success',
      archivo: {
        nombre: file.originalname,
        tamano_bytes: file.size,
        mimetype: file.mimetype,
        ruta_temporal: file.path,
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
