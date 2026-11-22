import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import {
  isGeminiConfigured,
  getLastWorkingModel,
  isModelInCooldown,
  obtenerModelosCandidatosGeneracion,
  generarContenidoMultimodalGemini,
} from './gemini.service.js';
import { registrarLogEjecucion, clasificarDepartamento, evaluarSla } from './automation.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../config/.env') });

const PRESUPUESTO_MULTIMODAL_MS = 3500;
const TIMEOUT_POR_INTENTO_MS = 3000;

const ETIQUETAS_CORTE = /\s+(?:correo|e-?mail|tel[eé]fono|celular|documento|identificaci[oó]n)\s*:/i;

const PATRON_SEPARADOR = /^\s*(?:[=\-_*~#•·]\s*){3,}$/;
const PATRON_METADATO_PLANTILLA = /^(?:identificador\s+de\s+archivo|condici[oó]n\s+de\s+captura|tipo\s+de\s+documento|datos\s+del\s+solicitante|detalles\s+de\s+la\s+solicitud|firma\s+y\s+sello|sello\s+de\s+radicaci[oó]n|formulario\s+de\s+atenci[oó]n|formato\s+institucional|fecha\s+de\s+(?:captura|radicaci[oó]n)|p[aá]gina\s+\d+|versi[oó]n\s*:)/i;
const PATRON_CAMPO_ESTRUCTURADO = /^(?:nombre(?:\s+completo)?|correo(?:\s+electr[oó]nico)?|e-?mail|tel[eé]fono(?:\s+de\s+contacto)?|celular|m[oó]vil|identificaci[oó]n|documento(?:\s+de\s+identidad)?|tipo(?:\s+de\s+(?:solicitud|documento|requerimiento))?|prioridad(?:\s+sugerida)?|nivel\s+de\s+prioridad|urgencia|[aá]rea(?:\s+de\s+destino)?|departamento(?:\s+sugerido)?|asunto|motivo|fecha(?:\s+de\s+\w+)?|hora|radicado)\b\s*:/i;

function esLineaRuidoPlantilla(linea) {
  if (!linea) return true;
  if (PATRON_SEPARADOR.test(linea)) return true;
  if (PATRON_METADATO_PLANTILLA.test(linea)) return true;
  if (PATRON_CAMPO_ESTRUCTURADO.test(linea)) return true;
  if (/^\[?(?:inicio|fin)[_ ]bloque/i.test(linea)) return true;
  if (/[\x00-\x08\x0E-\x1F\uFFFD]/.test(linea)) return true;
  return false;
}

function limpiarTextoDescripcion(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\u0000/g, ' ').trim())
    .map((linea) => linea.replace(/^descripci[oó]n(?:\s+[^:]*?)?\s*[:\-]\s*/i, '').trim())
    .filter((linea) => linea && !esLineaRuidoPlantilla(linea))
    .join(' ')
    .replace(/[=\-_*~#•·]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.]+|[\s:;,]+$/g, '')
    .trim();
}

function limpiarValorEtiqueta(valor) {
  if (!valor) return null;
  const limpio = String(valor).replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  return limpio.replace(ETIQUETAS_CORTE, '').trim() || null;
}

function buscarValorPorEtiqueta(lineas, patrones) {
  for (const lineaOriginal of lineas) {
    const linea = lineaOriginal.replace(/\u0000/g, ' ').trim();
    if (!linea) continue;
    for (const patron of patrones) {
      const coincidencia = linea.match(patron);
      if (coincidencia) {
        const valor = limpiarValorEtiqueta(coincidencia[1]);
        if (valor) return valor;
      }
    }
  }
  return null;
}

function normalizarTipoSolicitud(valor) {
  if (!valor) return null;
  const texto = valor.toLowerCase();
  if (/soporte|t[eé]cnico/.test(texto)) return 'Soporte Técnico';
  if (/reclamo/.test(texto)) return 'Reclamo';
  if (/queja/.test(texto)) return 'Queja';
  if (/sugerencia/.test(texto)) return 'Sugerencia';
  if (/petici[oó]n/.test(texto)) return 'Petición';
  return null;
}

function normalizarPrioridad(valor) {
  if (!valor) return null;
  const texto = valor.toLowerCase();
  if (/cr[íi]t/.test(texto)) return 'Crítica';
  if (/alta/.test(texto)) return 'Alta';
  if (/media/.test(texto)) return 'Media';
  if (/baja/.test(texto)) return 'Baja';
  return null;
}

/**
 * Obtiene el bloque de texto estructurado de un formulario.
 * Soporta buffers de texto plano y JPEG reales con comentario COM / bloque legible al final.
 */
function extraerBloqueTexto(buffer, mimeType, nombreArchivo = '') {
  let rawStr = '';
  try {
    rawStr = buffer.toString('utf8');
  } catch {
    return '';
  }

  const esTextoPlano = (typeof mimeType === 'string' && mimeType.startsWith('text/')) ||
    /\.(txt|md|csv|log)$/i.test(nombreArchivo || '');
  if (esTextoPlano) return rawStr;

  const marcadoresInicio = [
    'FORMULARIO DE ATENCIÓN DE PQRS B2B',
    'FORMULARIO DE ATENCION DE PQRS B2B',
    'FORMULARIO FÍSICO DE ATENCIÓN PQRS',
    'DATOS DEL SOLICITANTE',
    '[BLOQUE_TEXTO_VISION]',
  ];

  let inicio = -1;
  for (const marcador of marcadoresInicio) {
    const indice = rawStr.indexOf(marcador);
    if (indice !== -1 && (inicio === -1 || indice < inicio)) inicio = indice;
  }

  if (inicio !== -1) {
    return rawStr.slice(Math.max(0, inicio - 200), inicio + 2500);
  }

  const bloquesImprimibles = rawStr.match(/[\x20-\x7E\u00A0-\u00FF\r\n\t]{4,}/g) || [];
  return bloquesImprimibles.join('\n');
}

function extraerDescripcion(lineas) {
  const partes = [];
  let capturando = false;

  for (const lineaOriginal of lineas) {
    const linea = lineaOriginal.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
    if (!linea) continue;

    if (!capturando) {
      if (/^descripci[oOóÓ]n\b/i.test(linea)) {
        capturando = true;
        const resto = linea
          .replace(/^descripci[oó]n(?:\s+[^:]*?)?\s*[:\-]\s*/i, '')
          .trim();
        if (resto && resto !== linea && !esLineaRuidoPlantilla(resto)) partes.push(resto);
      }
      continue;
    }

    const esCierre =
      PATRON_SEPARADOR.test(linea) ||
      /^firma\s+y\s+sello/i.test(linea) ||
      /^sello\s+de\s+radicaci[oó]n/i.test(linea) ||
      /^datos\s+del\s+solicitante\b/i.test(linea) ||
      /^detalles\s+de\s+la\s+solicitud\b/i.test(linea) ||
      /^\[?fin[_ ]bloque/i.test(linea);
    if (esCierre) break;

    if (/[\x00-\x08\x0E-\x1F]/.test(linea)) break;
    if (esLineaRuidoPlantilla(linea)) continue;
    partes.push(linea);
  }

  return partes
    .join(' ')
    .replace(/[=\-_*~#•·]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.]+|[\s:;,]+$/g, '')
    .trim();
}

/**
 * Plan B: Extractor de contingencia cuando la cuota de IA se agota o no hay conexión
 */
function ejecutarPlanBHeuristico(buffer, mimeType, nombreArchivo = '') {
  const textoExtraido = extraerBloqueTexto(buffer, mimeType, nombreArchivo);
  const lineas = textoExtraido.split(/\r?\n/);

  const emailMatch = textoExtraido.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);

  const lineaTelefono = buscarValorPorEtiqueta(lineas, [
    /^(?:tel[eé]fono|celular|m[oó]vil)\b[^:]*[:\-]\s*(.+)$/i,
  ]);
  const telMatch = (lineaTelefono || textoExtraido).match(
    /(?:\+?\s?57[\s.-]?)?\b(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|[1-9]\d{6,9})\b/
  );

  const nombreLinea = buscarValorPorEtiqueta(lineas, [
    /^nombre(?:\s+completo)?\b[^:]*[:\-]\s*(.+)$/i,
    /^solicitante\b[^:]*[:\-]\s*(.+)$/i,
    /^cliente\b[^:]*[:\-]\s*(.+)$/i,
  ]);
  const nombreMatch = nombreLinea
    ? nombreLinea.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.'-]{2,80})/)
    : null;

  const tipoLinea = buscarValorPorEtiqueta(lineas, [
    /^tipo\s+de\s+(?:solicitud|requerimiento)\b[^:]*[:\-]\s*(.+)$/i,
  ]) || buscarValorPorEtiqueta(lineas, [
    /^tipo\b[^:]*[:\-]\s*(.+)$/i,
  ]);
  const tipoExplicit = normalizarTipoSolicitud(tipoLinea);

  const prioridadLinea = buscarValorPorEtiqueta(lineas, [
    /^(?:nivel\s+de\s+)?prioridad\b[^:]*[:\-]\s*(.+)$/i,
    /^(?:urgencia)\b[^:]*[:\-]\s*(.+)$/i,
  ]);
  const prioridadExplicit = normalizarPrioridad(prioridadLinea);

  const areaLinea = buscarValorPorEtiqueta(lineas, [
    /^[ÁáA]rea\s+de\s+destino\b[^:]*[:\-]\s*(.+)$/i,
    /^[ÁáA]rea\b[^:]*[:\-]\s*(.+)$/i,
    /^departamento(?:\s+sugerido)?\b[^:]*[:\-]\s*(.+)$/i,
  ]);

  const asuntoLinea = buscarValorPorEtiqueta(lineas, [
    /^(?:asunto|motivo)\b[^:]*[:\-]\s*(.+)$/i,
  ]);

  const descripcionExtraida = extraerDescripcion(lineas);
  const transcripcionLimpia = descripcionExtraida || limpiarTextoDescripcion(textoExtraido);

  let tipoDetectado = tipoExplicit || 'Petición';
  if (!tipoExplicit) {
    if (/reclamo|averia|defecto/i.test(textoExtraido)) tipoDetectado = 'Reclamo';
    else if (/queja|inconformidad|demora/i.test(textoExtraido)) tipoDetectado = 'Queja';
    else if (/soporte|falla|error|sistema|caido|alarma|sensor/i.test(textoExtraido)) tipoDetectado = 'Soporte Técnico';
    else if (/sugerencia|mejora|sugerimos/i.test(textoExtraido)) tipoDetectado = 'Sugerencia';
  }

  let prioridadDetectada = prioridadExplicit || 'Media';
  if (!prioridadExplicit) {
    if (/urgente|inmediato|cr[íi]tic|bloqueante/i.test(textoExtraido)) prioridadDetectada = 'Alta';
    else if (tipoDetectado === 'Reclamo') prioridadDetectada = 'Alta';
    else if (tipoDetectado === 'Sugerencia') prioridadDetectada = 'Baja';
  }

  const nombreExtraido = nombreMatch ? nombreMatch[1].trim() : 'Ciudadano por Verificar';
  const depto = areaLinea || clasificarDepartamento(asuntoLinea || nombreArchivo, descripcionExtraida || textoExtraido, tipoDetectado);

  const camposCompletos = Boolean(nombreMatch && emailMatch && telMatch);
  const camposEstructurados = Boolean(camposCompletos && tipoExplicit && areaLinea && asuntoLinea);
  const scoreBase = camposEstructurados ? 0.94 : (camposCompletos ? 0.88 : 0.72);

  return {
    modelo_utilizado: 'Plan B (Contingencia Local Heurística)',
    es_plan_b: true,
    score_confianza: scoreBase,
    requiere_revision_humana: scoreBase < 0.85,
    advertencias: [
      'Modelo de IA principal en la nube no disponible (Plan B activado).',
      'Extracción heurística estructurada ejecutada en servidor local.',
    ],
    confianza_por_campo: {
      nombre: nombreMatch ? 0.95 : 0.40,
      email: emailMatch ? 0.95 : 0.30,
      telefono: telMatch ? 0.92 : 0.30,
      tipo_solicitud: tipoExplicit ? 0.94 : 0.75,
      prioridad_sugerida: prioridadExplicit ? 0.92 : 0.70,
      asunto: asuntoLinea ? 0.90 : 0.60,
      descripcion: descripcionExtraida ? 0.88 : 0.60,
    },
    datos_extraidos: {
      nombre_solicitante: nombreExtraido,
      email_solicitante: emailMatch ? emailMatch[0] : '',
      telefono_solicitante: telMatch ? telMatch[0] : '',
      tipo_solicitud: tipoDetectado,
      prioridad_sugerida: prioridadDetectada,
      area_sugerida: depto,
      asunto: asuntoLinea || `Digitalización física: ${nombreArchivo || 'Formulario PQRS'}`,
      descripcion: descripcionExtraida || (transcripcionLimpia.length > 20
        ? transcripcionLimpia.slice(0, 500)
        : 'Formulario físico digitalizado pendiente de confirmación manual de contenido por el agente.'),
    },
  };
}

/**
 * Procesa un formulario físico PQRS o imagen de novedad con IA Multimodal
 * @param {Buffer} fileBuffer Buffer del archivo de imagen (JPG, PNG, WebP) o PDF
 * @param {string} mimeType Tipo MIME
 * @param {string} nombreArchivo Nombre original del archivo
 * @param {string} usuarioId Identificador del usuario que realiza la carga
 */
export async function procesarFormularioConVision(fileBuffer, mimeType, nombreArchivo = 'formulario.jpg', usuarioId = 'AGENTE') {
  const inicioMs = Date.now();

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('El archivo proporcionado está vacío.');
  }

  // Sin GEMINI_API_KEY utilizable: short-circuit inmediato (0ms) al Plan B
  if (!isGeminiConfigured()) {
    console.warn('[Vision Service] GEMINI_API_KEY no configurada. Conmutando a Plan B.');
    const resultadoPlanB = ejecutarPlanBHeuristico(fileBuffer, mimeType, nombreArchivo);
    await registrarLogEjecucion({
      flujo: 'VISION_FORMULARIO_FISICO',
      disparador: 'POST /api/vision/procesar-formulario',
      actor: usuarioId,
      estado: 'REINTENTO',
      datos_entrada: { nombreArchivo, mimeType, tamanoBytes: fileBuffer.length },
      datos_salida: { modelo: resultadoPlanB.modelo_utilizado, confianza: resultadoPlanB.score_confianza },
      tiempo_ms: Date.now() - inicioMs,
    });
    return resultadoPlanB;
  }

  try {
    const base64Data = fileBuffer.toString('base64');

    const promptVision = `
Eres un sistema experto de Visión por Computador e IA Multimodal para la digitalización empresarial de formularios físicos y novedades de PQRS B2B.
Analiza detenidamente la imagen o documento proporcionado (formulario físico diligenciado a mano o impreso, factura, acta o foto de novedad).

Tu objetivo es extraer con máxima precisión los datos requeridos y estructurarlos en formato JSON estricto.

Debes responder ÚNICAMENTE un bloque de código JSON con este esquema exacto:
{
  "nombre_solicitante": "Nombre completo extraído o null si no es visible",
  "email_solicitante": "Correo electrónico extraído o null",
  "telefono_solicitante": "Número telefónico extraído o null",
  "tipo_solicitud": "Uno de: Petición, Queja, Reclamo, Soporte Técnico, Sugerencia",
  "prioridad_sugerida": "Uno de: Baja, Media, Alta, Crítica",
  "area_sugerida": "Uno de: Soporte Técnico y Sistemas, Facturación y Cobranzas, Control de Calidad y Garantías",
  "asunto": "Resumen conciso y profesional del caso (máximo 120 caracteres)",
  "descripcion": "Redacción limpia, concisa, profesional y en lenguaje natural del motivo del reclamo, queja, petición, sugerencia o problema reportado (2 a 4 oraciones). No copies encabezados de plantilla, sellos, metadatos técnicos, identificadores de archivo, condiciones de captura ni separadores.",
  "detalles_visibles": ["Sellos encontrados", "Números de radicado impresos", "Fechas detectadas", "Averías o firmas"],
  "score_confianza": 0.92,
  "confianza_por_campo": {
    "nombre": 0.95,
    "email": 0.90,
    "telefono": 0.85,
    "tipo_solicitud": 0.90,
    "asunto": 0.92,
    "descripcion": 0.88
  },
  "advertencias": []
}

Reglas estrictas:
1. El "score_confianza" es un número decimal entre 0.00 y 1.00 que refleja la legibilidad visual, nitidez e integridad de los datos.
2. Si la foto tiene poca luz, inclinación severa o letra difícil de leer, reduce la confianza correspondiente y añade advertencias en el arreglo "advertencias".
3. Si un campo no es visible o está ausente, coloca null y añade una advertencia.
4. La "descripcion" debe ser una redacción propia, limpia, concisa, profesional y en lenguaje natural que explique el motivo del reclamo o problema, sin incluir encabezados de plantilla, sellos, metadatos técnicos, identificadores o nombres de archivo, condiciones de captura ni separadores (===, ---).
5. NO agregues texto conversacional fuera del JSON.
`;

    // Circuit Breaker compartido con el motor RAG: prioriza el modelo caliente
    // (si no está en cooldown), filtra modelos en cooldown y ejecuta una carrera
    // paralela acotada a 3500ms con AbortSignal.timeout(3000) por intento.
    const modeloCaliente = getLastWorkingModel();
    const candidatos = obtenerModelosCandidatosGeneracion();
    if (candidatos.length === 0) {
      throw new Error('Todos los modelos multimodales están en cooldown; Plan B inmediato');
    }

    const resultadoMultimodal = await generarContenidoMultimodalGemini({
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptVision },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ],
      presupuestoMaximoMs: PRESUPUESTO_MULTIMODAL_MS,
      timeoutPorIntentoMs: TIMEOUT_POR_INTENTO_MS,
      temperature: 0.2,
    });

    if (!resultadoMultimodal.texto) {
      const detalleCircuito = modeloCaliente && isModelInCooldown(modeloCaliente)
        ? `circuito abierto para ${modeloCaliente}`
        : 'circuito abierto por presupuesto de latencia';
      throw new Error(`Ningún modelo multimodal en la nube respondió satisfactoriamente (${detalleCircuito})`);
    }

    const modeloExitoso = resultadoMultimodal.modelo;
    const rawOutput = resultadoMultimodal.texto;
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('La respuesta de visión no devolvió un JSON legible');
    }

    const parsedData = JSON.parse(jsonMatch[0]);

    // Evaluación del umbral de revisión humana (Umbral fijado en 0.85 según diseño de Semana 1)
    const scoreGlobal = Number(parsedData.score_confianza) || 0.75;
    const requiereRevision = scoreGlobal < 0.85 ||
      !parsedData.nombre_solicitante ||
      !parsedData.email_solicitante ||
      (parsedData.advertencias && parsedData.advertencias.length > 0);

    const resultadoFinal = {
      modelo_utilizado: `Google ${modeloExitoso} Vision (Multimodal)`,
      es_plan_b: false,
      score_confianza: scoreGlobal,
      requiere_revision_humana: requiereRevision,
      advertencias: parsedData.advertencias || [],
      confianza_por_campo: parsedData.confianza_por_campo || {},
      datos_extraidos: {
        nombre_solicitante: parsedData.nombre_solicitante || 'Ciudadano',
        email_solicitante: parsedData.email_solicitante || '',
        telefono_solicitante: parsedData.telefono_solicitante || '',
        tipo_solicitud: parsedData.tipo_solicitud || 'Petición',
        prioridad_sugerida: parsedData.prioridad_sugerida || 'Media',
        area_sugerida: parsedData.area_sugerida || 'Soporte Técnico y Sistemas',
        asunto: parsedData.asunto || `Solicitud digitalizada: ${nombreArchivo}`,
        descripcion: parsedData.descripcion || 'Sin descripción legible extraída.',
        detalles_visibles: parsedData.detalles_visibles || [],
      },
    };

    const tiempoMs = Date.now() - inicioMs;
    await registrarLogEjecucion({
      flujo: 'VISION_FORMULARIO_FISICO',
      disparador: 'POST /api/vision/procesar-formulario',
      actor: usuarioId,
      estado: 'EXITO',
      datos_entrada: { nombreArchivo, mimeType, tamanoBytes: fileBuffer.length },
      datos_salida: { modelo: resultadoFinal.modelo_utilizado, confianza: scoreGlobal },
      tiempo_ms: tiempoMs,
    });

    return resultadoFinal;
  } catch (err) {
    console.warn('[Vision Service] Fallo en modelo primario de visión:', err.message, '-> Activando Plan B');
    const planB = ejecutarPlanBHeuristico(fileBuffer, mimeType, nombreArchivo);
    planB.advertencias.push(`Fallo del modelo primario: ${err.message}`);

    const tiempoMs = Date.now() - inicioMs;
    await registrarLogEjecucion({
      flujo: 'VISION_FORMULARIO_FISICO',
      disparador: 'POST /api/vision/procesar-formulario',
      actor: usuarioId,
      estado: 'REINTENTO',
      datos_entrada: { nombreArchivo, mimeType, tamanoBytes: fileBuffer.length },
      datos_salida: { modelo: planB.modelo_utilizado, confianza: planB.score_confianza },
      mensaje_error: err.message,
      tiempo_ms: tiempoMs,
    });

    return planB;
  }
}

const TIPOS_DOCUMENTO_BOVEDA = [
  'Contrato',
  'Factura',
  'Documento de Identidad',
  'Acta',
  'Normativa',
  'Soporte General',
];

function esArchivoTextoGeneral(mimeType, nombreArchivo) {
  const mime = String(mimeType || '').toLowerCase();
  const nombre = String(nombreArchivo || '').toLowerCase();
  return mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    /\.(txt|md|csv|log|json|xml|html?)$/i.test(nombre);
}

function esArchivoPdfGeneral(mimeType, nombreArchivo) {
  const mime = String(mimeType || '').toLowerCase();
  return mime === 'application/pdf' || /\.pdf$/i.test(String(nombreArchivo || ''));
}

function extraerTextoImprimibleGeneral(buffer) {
  const raw = buffer.toString('latin1');
  const fragmentos = [];
  const patronTj = /\((.{2,}?)\)\s*Tj/g;
  let coincidencia;

  while ((coincidencia = patronTj.exec(raw)) !== null) {
    const fragmento = coincidencia[1]
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .trim();
    if (fragmento) fragmentos.push(fragmento);
  }

  if (fragmentos.length > 0) return fragmentos.join('\n');

  const bloques = raw.match(/[\x20-\x7E\u00A0-\u00FF\r\n\t]{12,}/g) || [];
  return bloques
    .map((bloque) => bloque
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((bloque) => {
      if (bloque.length < 12) return false;
      const imprimibles = bloque.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').length;
      return imprimibles / bloque.length >= 0.85;
    })
    .join('\n')
    .trim();
}

async function extraerTextoDocumentoGeneral(buffer, mimeType, nombreArchivo) {
  if (esArchivoTextoGeneral(mimeType, nombreArchivo)) {
    return buffer.toString('utf8').replace(/\u0000/g, ' ').trim();
  }

  if (esArchivoPdfGeneral(mimeType, nombreArchivo)) {
    try {
      const data = await pdfParse(buffer);
      if (data && typeof data.text === 'string' && data.text.trim()) {
        return data.text.replace(/\u0000/g, ' ').trim();
      }
    } catch (error) {
      console.warn('[Vision Service] pdfParse no pudo extraer texto del PDF:', error.message);
    }
    return extraerTextoImprimibleGeneral(buffer);
  }

  return '';
}

function inferirTipoDocumentoGeneral(texto, nombreArchivo = '') {
  const contenido = `${nombreArchivo}\n${texto}`.toLowerCase();
  if (/c[eé]dula|documento de identidad|pasaporte|tarjeta de identidad/.test(contenido)) return 'Documento de Identidad';
  if (/contrato|convenio|cl[aá]usula|acuerdo de voluntades/.test(contenido)) return 'Contrato';
  if (/factura|cuenta de cobro|\bnit\b|subtotal|\biva\b/.test(contenido)) return 'Factura';
  if (/\bacta\b|reuni[oó]n|sesi[oó]n/.test(contenido)) return 'Acta';
  if (/normativa|decreto|resoluci[oó]n|ley\s+\d|circular/.test(contenido)) return 'Normativa';
  return 'Soporte General';
}

function normalizarTipoDocumentoGeneral(valor, texto, nombreArchivo = '') {
  const candidato = String(valor || '').trim().toLowerCase();
  const encontrado = TIPOS_DOCUMENTO_BOVEDA.find((tipo) => tipo.toLowerCase() === candidato);
  if (encontrado) return encontrado;
  return inferirTipoDocumentoGeneral(texto, nombreArchivo);
}

function extraerTituloSugeridoGeneral(texto, nombreArchivo) {
  const lineas = String(texto || '')
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\s+/g, ' ').trim())
    .filter((linea) => linea.length >= 6);

  if (lineas.length > 0) return lineas[0].slice(0, 160);

  const base = String(nombreArchivo || 'Documento digitalizado')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return base ? `Documento: ${base}`.slice(0, 160) : 'Documento digitalizado';
}

function extraerEntidadesClaveGeneral(texto, nombreArchivo = '') {
  const contenido = String(texto || '');
  const lineas = contenido
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const buscarLinea = (patron) => {
    for (const linea of lineas) {
      const coincidencia = linea.match(patron);
      if (coincidencia && coincidencia[1]) return coincidencia[1].trim().slice(0, 160);
    }
    return null;
  };

  const documento = contenido.match(
    /\b(?:nit|documento(?:\s+de\s+identidad)?|c[eé]dula|identificaci[oó]n)\b[^\d]{0,20}([\d.\-]{5,20})/i
  );
  const fecha = contenido.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/);
  const monto = contenido.match(/(?:total|monto|valor)\b[^\d$]{0,15}\$?\s*([\d.,]{3,})/i);

  return {
    emisor: buscarLinea(/^(?:emisor|remitente|proveedor|empresa|de)\s*[:\-]\s*(.+)$/i) ||
      (lineas[0] ? lineas[0].slice(0, 160) : null),
    receptor: buscarLinea(/^(?:receptor|destinatario|cliente|para|se[ñn]or(?:a)?)\s*[:\-]\s*(.+)$/i) ||
      (lineas[1] ? lineas[1].slice(0, 160) : null),
    documento_id_o_nit: documento ? documento[1] : null,
    fecha_documento: fecha ? fecha[1] : null,
    monto_total: monto ? monto[1] : null,
  };
}

function construirResumenLocalGeneral(texto, nombreArchivo) {
  const frases = String(texto || '')
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((linea) => linea.replace(/\s+/g, ' ').trim())
    .filter((linea) => linea.length >= 20);

  const base = frases.slice(0, 3).join('. ').replace(/\.+$/, '');
  if (base) {
    return `${base.slice(0, 700)}. Documento incorporado a la Bóveda Documental para consulta, búsqueda semántica y trazabilidad.`;
  }

  return `Documento "${nombreArchivo || 'sin nombre'}" digitalizado hacia la Bóveda Documental. El motor de visión no está disponible y no se pudo transcribir el contenido completo del archivo. El original se conserva para revisión y auditoría humana.`;
}

function normalizarScoreConfianzaGeneral(valor) {
  let score = Number(valor);
  if (!Number.isFinite(score)) score = 0.75;
  if (score > 1 && score <= 100) score = score / 100;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

async function ejecutarPlanBDocumentoGeneral(fileBuffer, mimeType, nombreArchivo, usuarioId, motivo) {
  const inicioMs = Date.now();
  const textoExtraido = await extraerTextoDocumentoGeneral(fileBuffer, mimeType, nombreArchivo);
  const textoOcr = textoExtraido.slice(0, 20000);
  const tieneTexto = textoOcr.replace(/\s+/g, '').length >= 40;

  const advertencias = [
    'El modelo de visión en la nube no está disponible; se activó el Plan B local de contingencia.',
  ];
  if (tieneTexto) {
    advertencias.push('Texto extraído localmente sin análisis semántico del modelo; valida el tipo de documento y las entidades clave.');
  } else {
    advertencias.push('No fue posible extraer texto legible del archivo; se generó un resumen base que requiere revisión humana.');
  }
  if (motivo) advertencias.push(`Detalle técnico: ${String(motivo).slice(0, 180)}`);

  const resultado = {
    modelo_utilizado: 'Plan B (Extractor Local de Documentos)',
    es_plan_b: true,
    score_confianza: tieneTexto ? 0.68 : 0.55,
    requiere_revision_humana: true,
    advertencias,
    datos_documento: {
      titulo_sugerido: extraerTituloSugeridoGeneral(textoOcr, nombreArchivo),
      tipo_documento: inferirTipoDocumentoGeneral(textoOcr, nombreArchivo),
      entidades_clave: extraerEntidadesClaveGeneral(textoOcr, nombreArchivo),
      resumen_ejecutivo: construirResumenLocalGeneral(textoOcr, nombreArchivo),
      texto_ocr_completo: textoOcr,
    },
  };

  await registrarLogEjecucion({
    flujo: 'VISION_DOCUMENTO_BOVEDA',
    disparador: 'POST /api/vision/procesar-formulario',
    actor: usuarioId,
    estado: 'REINTENTO',
    datos_entrada: { nombreArchivo, mimeType, tamanoBytes: fileBuffer.length },
    datos_salida: { modelo: resultado.modelo_utilizado, confianza: resultado.score_confianza },
    mensaje_error: motivo ? String(motivo).slice(0, 300) : null,
    tiempo_ms: Date.now() - inicioMs,
  });

  return resultado;
}

export async function analizarDocumentoGeneralConVision(
  fileBuffer,
  mimeType,
  nombreArchivo = 'documento.pdf',
  usuarioId = 'SISTEMA'
) {
  const inicioMs = Date.now();

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('El archivo proporcionado está vacío.');
  }

  if (!isGeminiConfigured()) {
    console.warn('[Vision Service] GEMINI_API_KEY no configurada. Plan B para Bóveda Documental.');
    return ejecutarPlanBDocumentoGeneral(
      fileBuffer,
      mimeType,
      nombreArchivo,
      usuarioId,
      'GEMINI_API_KEY no configurada'
    );
  }

  try {
    const base64Data = fileBuffer.toString('base64');

    const promptDocumentoGeneral = `
Eres un sistema experto de Visión por Computador e IA Multimodal para la digitalización y clasificación de documentos empresariales generales en la Bóveda Documental de DocuMind.
Analiza detenidamente la imagen o documento proporcionado (facturas, contratos, cédulas, actas, comprobantes, normativa, soportes generales).

Debes responder ÚNICAMENTE un bloque de código JSON con este esquema exacto:
{
  "titulo_sugerido": "Título breve, claro y profesional del documento (máximo 120 caracteres)",
  "tipo_documento": "Uno de: Contrato, Factura, Documento de Identidad, Acta, Normativa, Soporte General",
  "entidades_clave": {
    "emisor": "Empresa, entidad o persona que emite el documento, o null",
    "receptor": "Empresa, entidad o persona destinataria, o null",
    "documento_id_o_nit": "NIT, cédula, radicado o identificador visible, o null",
    "fecha_documento": "Fecha del documento en formato AAAA-MM-DD si es visible, o null",
    "monto_total": "Monto total visible con su moneda, o null"
  },
  "resumen_ejecutivo": "Resumen profesional en español de 2 a 4 oraciones que explique el objeto, las partes y los datos relevantes del documento.",
  "texto_ocr_completo": "Transcripción completa, fiel y ordenada de todo el texto legible en la imagen o PDF, conservando el orden de lectura.",
  "score_confianza": 0.92,
  "advertencias": []
}

Reglas estrictas:
1. "score_confianza" es un decimal entre 0.00 y 1.00 que refleja la legibilidad, nitidez e integridad de los datos.
2. Si la imagen tiene poca luz, inclinación, recortes o texto ilegible, reduce la confianza y agrega advertencias claras.
3. Si un dato no es visible, usa null y añade una advertencia cuando sea relevante.
4. "texto_ocr_completo" debe contener toda la transcripción legible, no un resumen ni fragmentos omitidos.
5. "resumen_ejecutivo" debe ser una redacción propia en español profesional, sin encabezados de plantilla ni separadores.
6. NO agregues texto conversacional fuera del JSON.
`;

    const modeloCaliente = getLastWorkingModel();
    const candidatos = obtenerModelosCandidatosGeneracion();
    if (candidatos.length === 0) {
      throw new Error('Todos los modelos multimodales están en cooldown; Plan B inmediato');
    }

    const resultadoMultimodal = await generarContenidoMultimodalGemini({
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptDocumentoGeneral },
            {
              inlineData: {
                mimeType: mimeType || 'application/pdf',
                data: base64Data,
              },
            },
          ],
        },
      ],
      presupuestoMaximoMs: PRESUPUESTO_MULTIMODAL_MS,
      timeoutPorIntentoMs: TIMEOUT_POR_INTENTO_MS,
      temperature: 0.2,
    });

    if (!resultadoMultimodal.texto) {
      const detalleCircuito = modeloCaliente && isModelInCooldown(modeloCaliente)
        ? `circuito abierto para ${modeloCaliente}`
        : 'circuito abierto por presupuesto de latencia';
      throw new Error(`Ningún modelo multimodal en la nube respondió satisfactoriamente (${detalleCircuito})`);
    }

    const jsonMatch = resultadoMultimodal.texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('La respuesta de visión no devolvió un JSON legible');
    }

    const parsedData = JSON.parse(jsonMatch[0]);
    const scoreGlobal = normalizarScoreConfianzaGeneral(parsedData.score_confianza);
    const entidades = parsedData.entidades_clave && typeof parsedData.entidades_clave === 'object'
      ? parsedData.entidades_clave
      : {};
    const textoOcr = typeof parsedData.texto_ocr_completo === 'string'
      ? parsedData.texto_ocr_completo.trim()
      : '';
    const tituloSugerido = typeof parsedData.titulo_sugerido === 'string' && parsedData.titulo_sugerido.trim()
      ? parsedData.titulo_sugerido.trim().slice(0, 160)
      : `Documento digitalizado: ${nombreArchivo}`;
    const resumenEjecutivo = typeof parsedData.resumen_ejecutivo === 'string' && parsedData.resumen_ejecutivo.trim()
      ? parsedData.resumen_ejecutivo.trim()
      : `Documento "${nombreArchivo}" digitalizado e incorporado a la Bóveda Documental para consulta y trazabilidad.`;
    const advertencias = Array.isArray(parsedData.advertencias)
      ? parsedData.advertencias.filter((advertencia) => typeof advertencia === 'string' && advertencia.trim())
      : [];

    const resultadoFinal = {
      modelo_utilizado: `Google ${resultadoMultimodal.modelo} Vision (Multimodal)`,
      es_plan_b: false,
      score_confianza: scoreGlobal,
      requiere_revision_humana: scoreGlobal < 0.85 || !textoOcr || advertencias.length > 0,
      advertencias,
      datos_documento: {
        titulo_sugerido: tituloSugerido,
        tipo_documento: normalizarTipoDocumentoGeneral(parsedData.tipo_documento, textoOcr, nombreArchivo),
        entidades_clave: {
          emisor: entidades.emisor ?? null,
          receptor: entidades.receptor ?? null,
          documento_id_o_nit: entidades.documento_id_o_nit ?? null,
          fecha_documento: entidades.fecha_documento ?? null,
          monto_total: entidades.monto_total ?? null,
        },
        resumen_ejecutivo: resumenEjecutivo,
        texto_ocr_completo: textoOcr,
      },
    };

    await registrarLogEjecucion({
      flujo: 'VISION_DOCUMENTO_BOVEDA',
      disparador: 'POST /api/vision/procesar-formulario',
      actor: usuarioId,
      estado: 'EXITO',
      datos_entrada: { nombreArchivo, mimeType, tamanoBytes: fileBuffer.length },
      datos_salida: { modelo: resultadoFinal.modelo_utilizado, confianza: scoreGlobal },
      tiempo_ms: Date.now() - inicioMs,
    });

    return resultadoFinal;
  } catch (err) {
    console.warn('[Vision Service] Fallo en visión para Bóveda Documental:', err.message, '-> Activando Plan B');
    return ejecutarPlanBDocumentoGeneral(fileBuffer, mimeType, nombreArchivo, usuarioId, err.message);
  }
}
