import crypto from 'crypto';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';
import { analizarDocumentoGeneralConVision, procesarFormularioConVision } from '../services/vision.service.js';
import { dividirEnChunks, generarEmbeddingGoogle } from '../services/gemini.service.js';
import { upsertChunks } from '../services/pinecone.service.js';

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
    const modo = String(req.body?.modo || 'pqrs').toLowerCase();

    if (modo === 'boveda' && !req.user) {
      return res.status(401).json({
        ok: false,
        status: 'error',
        mensaje: 'Inicia sesión para digitalizar hacia la Bóveda Documental.',
      });
    }

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

    const resultado = modo === 'boveda'
      ? await analizarDocumentoGeneralConVision(fileBuffer, file.mimetype, file.originalname, usuarioId)
      : await procesarFormularioConVision(fileBuffer, file.mimetype, file.originalname, usuarioId);

    registrarAccesoVision({
      archivo: file.filename,
      nombre_original: file.originalname,
      sha256,
      subido_por: usuarioId,
      rol: req.user?.rol || 'ANONIMO',
      modo,
      fecha_subida: new Date().toISOString(),
    });

    const respuesta = {
      ok: true,
      status: 'success',
      ...(modo === 'boveda' ? { modo: 'boveda' } : {}),
      archivo: {
        nombre: file.originalname,
        archivo_servidor: file.filename,
        tamano_bytes: file.size,
        mimetype: file.mimetype,
        sha256,
        url_protegida: `/api/vision/archivos/${file.filename}`,
      },
      ...resultado,
    };

    return res.status(200).json(respuesta);
  } catch (error) {
    console.error('[Vision Controller] Error al procesar imagen:', error.message);
    return res.status(500).json({
      ok: false,
      status: 'error',
      mensaje: `Error al procesar formulario con visión: ${error.message}`,
    });
  }
}

function parsearMetadatosVision(metadatos) {
  if (!metadatos) return {};
  if (typeof metadatos === 'object' && !Array.isArray(metadatos)) return metadatos;
  if (typeof metadatos === 'string') {
    try {
      const parsed = JSON.parse(metadatos);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      throw new Error('El campo metadatos debe ser un objeto JSON válido.');
    }
  }
  throw new Error('El campo metadatos debe ser un objeto JSON válido.');
}

function determinarTipoFormatoVision(nombreArchivo) {
  const extension = path.extname(String(nombreArchivo || '')).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'JPG';
  if (extension === '.png') return 'PNG';
  if (extension === '.webp') return 'WEBP';
  if (extension === '.pdf') return 'PDF';
  if (extension === '.txt') return 'TXT';
  return 'SCAN';
}

export async function indexarDocumentoVisionController(req, res) {
  const {
    repositorio_id,
    titulo_archivo,
    tipo_documento,
    resumen_ejecutivo,
    texto_ocr_completo,
    metadatos,
    archivo_servidor,
  } = req.body || {};

  const repositorioId = Number(repositorio_id);
  if (!Number.isInteger(repositorioId) || repositorioId <= 0) {
    return res.status(400).json({
      ok: false,
      mensaje: 'repositorio_id debe ser un entero positivo.',
    });
  }

  let metadataUsuario;
  try {
    metadataUsuario = parsearMetadatosVision(metadatos);
  } catch (error) {
    return res.status(400).json({ ok: false, mensaje: error.message });
  }

  const tituloArchivo = String(titulo_archivo || '').trim() || 'Documento digitalizado';
  const tipoDocumento = String(tipo_documento || '').trim() || 'Soporte General';
  const resumenEjecutivo = String(resumen_ejecutivo || '').trim();
  const textoOcr = String(texto_ocr_completo || '').trim();

  let scoreConfianza = Number(req.body?.score_confianza);
  if (!Number.isFinite(scoreConfianza)) scoreConfianza = 0.75;
  if (scoreConfianza > 1 && scoreConfianza <= 100) scoreConfianza /= 100;
  scoreConfianza = Math.max(0, Math.min(1, Number(scoreConfianza.toFixed(2))));

  let documentoId = null;
  let archivoCreado = null;

  try {
    const repos = await db.query(
      'SELECT id, departamento, usuario_id FROM repositorios WHERE id = ?',
      [repositorioId]
    );
    if (repos.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Repositorio no encontrado.' });
    }

    const repo = repos[0];
    const rolUsuario = (req.user?.rol || '').toUpperCase();
    const ROLES_GLOBALES = ['ADMIN', 'AGENTE', 'SUPERVISOR'];
    if (!ROLES_GLOBALES.includes(rolUsuario)) {
      let deptoPermitido = 'Legal';
      if (rolUsuario === 'FINANCIERO') deptoPermitido = 'Financiero';
      if (rolUsuario === 'RECLUTADOR') deptoPermitido = 'Recursos Humanos';

      const tienePermisoRepo = (repo.departamento === deptoPermitido) || (repo.usuario_id === req.user?.id);
      if (!tienePermisoRepo) {
        return res.status(403).json({
          ok: false,
          mensaje: 'No tiene permisos para indexar documentos en este repositorio.',
        });
      }
    }

    let archivoServidorFinal = null;
    let rutaFisica = null;
    let tamanoBytes = 0;
    let tipoFormato = 'SCAN';

    if (req.file) {
      archivoServidorFinal = req.file.filename;
      rutaFisica = req.file.path;
      tamanoBytes = req.file.size;
      tipoFormato = determinarTipoFormatoVision(req.file.originalname || req.file.filename);
      archivoCreado = rutaFisica;
    } else if (archivo_servidor) {
      const nombreSolicitado = String(archivo_servidor).trim();
      const nombreBase = path.basename(nombreSolicitado);
      if (
        !nombreBase ||
        nombreBase !== nombreSolicitado ||
        nombreSolicitado.includes('\0') ||
        nombreSolicitado.includes(':')
      ) {
        return res.status(400).json({ ok: false, mensaje: 'Nombre de archivo inválido.' });
      }

      rutaFisica = path.resolve(uploadsDir, nombreBase);
      const rutaRelativa = path.relative(uploadsDir, rutaFisica);
      if (rutaRelativa.startsWith('..') || path.isAbsolute(rutaRelativa)) {
        return res.status(403).json({ ok: false, mensaje: 'Acceso al archivo no permitido.' });
      }
      if (!fs.existsSync(rutaFisica) || !fs.statSync(rutaFisica).isFile()) {
        return res.status(404).json({ ok: false, mensaje: 'Archivo físico no encontrado en el servidor.' });
      }

      archivoServidorFinal = nombreBase;
      tamanoBytes = fs.statSync(rutaFisica).size;
      tipoFormato = determinarTipoFormatoVision(nombreBase);
    } else {
      const nombreRespaldo = `vision-boveda-${Date.now()}-${Math.round(Math.random() * 1e9)}.txt`;
      rutaFisica = path.join(uploadsDir, nombreRespaldo);
      fs.mkdirSync(uploadsDir, { recursive: true });
      const contenidoRespaldo = textoOcr || resumenEjecutivo || tituloArchivo;
      fs.writeFileSync(rutaFisica, contenidoRespaldo, 'utf8');
      archivoServidorFinal = nombreRespaldo;
      tamanoBytes = fs.statSync(rutaFisica).size;
      tipoFormato = 'TXT';
      archivoCreado = rutaFisica;
    }

    const urlDescarga = `/uploads/${archivoServidorFinal}`;
    const textoCompleto = [resumenEjecutivo, textoOcr].filter(Boolean).join('\n\n').trim() || tituloArchivo;
    const extractoClave = textoOcr.replace(/\s+/g, ' ').trim().slice(0, 1200);
    const resumenIA = [
      resumenEjecutivo,
      extractoClave ? `Extracto del documento: ${extractoClave}` : '',
    ].filter(Boolean).join('\n\n') || `Documento digitalizado: ${tituloArchivo}`;

    const insertResult = await db.query(
      `INSERT INTO documentos
        (nombre_archivo, url_descarga, tipo_formato, tamano_bytes, estado_procesamiento,
         categoria_detectada, score_confianza, resumen_ia, repositorio_id)
       VALUES (?, ?, ?, ?, 'COMPLETADO', ?, ?, ?, ?)`,
      [
        tituloArchivo,
        urlDescarga,
        tipoFormato,
        tamanoBytes,
        tipoDocumento,
        scoreConfianza,
        resumenIA,
        repositorioId,
      ]
    );
    documentoId = insertResult.insertId;
    if (!documentoId) {
      throw new Error('No se pudo obtener el identificador del documento indexado.');
    }

    const metadataFinal = {
      ...metadataUsuario,
      archivo_servidor: archivoServidorFinal,
      tipo_formato: tipoFormato,
      tamano_bytes: tamanoBytes,
      origen: 'VISION_BOVEDA',
      indexado_en: new Date().toISOString(),
    };

    await db.query(
      'INSERT INTO metadatos_extraidos (documento_id, metadata_json) VALUES (?, ?)',
      [documentoId, JSON.stringify(metadataFinal)]
    );

    const textosChunks = dividirEnChunks(textoCompleto);
    const chunksConEmbedding = [];
    for (let i = 0; i < textosChunks.length; i++) {
      const embedding = await generarEmbeddingGoogle(textosChunks[i], { presupuestoMaximoMs: 3000 });
      chunksConEmbedding.push({
        texto: textosChunks[i],
        embedding,
        pageNum: Math.floor(i / 3) + 1,
      });
    }

    try {
      await upsertChunks(chunksConEmbedding, documentoId, repositorioId, tituloArchivo, urlDescarga);
    } catch (pineconeErr) {
      console.warn('[Vision Bóveda] Indexación vectorial parcial:', pineconeErr.message);
    }

    const [documento] = await db.query('SELECT * FROM documentos WHERE id = ?', [documentoId]);

    return res.status(201).json({
      ok: true,
      mensaje: 'Documento digitalizado e indexado exitosamente en la bóveda.',
      documento,
      chunks_indexados: chunksConEmbedding.length,
    });
  } catch (error) {
    console.error('[Vision Controller] Error al indexar documento en bóveda:', error.message);

    if (documentoId) {
      try {
        await db.query("UPDATE documentos SET estado_procesamiento = 'ERROR' WHERE id = ?", [documentoId]);
      } catch {
        console.warn('[Vision Bóveda] No se pudo marcar el documento como ERROR.');
      }
    } else if (archivoCreado && fs.existsSync(archivoCreado)) {
      try {
        fs.unlinkSync(archivoCreado);
      } catch {
        console.warn('[Vision Bóveda] No se pudo limpiar el archivo temporal.');
      }
    }

    return res.status(500).json({
      ok: false,
      mensaje: 'Error al indexar el documento digitalizado en la bóveda.',
      error: error.message,
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

