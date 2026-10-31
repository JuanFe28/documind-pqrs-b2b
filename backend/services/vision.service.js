import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { getSecret } from '../utils/secrets.js';
import { registrarLogEjecucion, clasificarDepartamento, evaluarSla } from './automation.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../config/.env') });

const geminiApiKey = getSecret('GEMINI_API_KEY', {
  defaultValue: process.env.GEMINI_API_KEY || null,
  disallowDefaultInProduction: false,
});

const ai = new GoogleGenAI({ apiKey: geminiApiKey || '' });

/**
 * Envoltorio con timeout para peticiones de visión
 */
function conTimeout(promesa, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo de espera de visión agotado (${ms}ms)`)), ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Plan B: Extractor de contingencia cuando la cuota de IA se agota o no hay conexión
 */
function ejecutarPlanBHeuristico(buffer, mimeType, nombreArchivo = '') {
  let textoExtraido = '';
  try {
    // Intentar decodificar como texto plano o buscar cadenas imprimibles en el buffer
    const rawStr = buffer.toString('utf8');
    const printableMatches = rawStr.match(/[A-Za-z0-9áéíóúÁÉÍÓÚñÑ@.,:;\-_/\s]{4,}/g) || [];
    textoExtraido = printableMatches.join(' ').slice(0, 3000);
  } catch {
    textoExtraido = '';
  }

  // Búsqueda inteligente de patrones clave mediante expresiones regulares
  const emailMatch = textoExtraido.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const telMatch = textoExtraido.match(/(?:(?:\+|00)57\s?)?(?:3\d{2}[-.\s]?\d{3}[-.\s]?\d{4}|[1-9]\d{6})/);
  
  const nombreMatch = textoExtraido.match(/(?:nombre(?:\s+completo)?|solicitante|de:)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚñÑ][A-Za-zÁÉÍÓÚñÑ\s]{2,40})/i);
  const prioMatch = textoExtraido.match(/(?:prioridad|urgencia)\s*[:\-]?\s*(baja|media|alta|cr[íi]tica)/i);
  const tipoExplicitMatch = textoExtraido.match(/(?:tipo(?:\s+de\s+solicitud)?)\s*[:\-]?\s*(petici[oó]n|queja|reclamo|soporte\s+t[eé]cnico|sugerencia)/i);
  const asuntoMatch = textoExtraido.match(/(?:asunto|motivo)\s*[:\-]?\s*([^\r\n]{5,100})/i);

  let tipoDetectado = 'Petición';
  if (tipoExplicitMatch) {
    const rawTipo = tipoExplicitMatch[1].toLowerCase();
    if (rawTipo.includes('reclamo')) tipoDetectado = 'Reclamo';
    else if (rawTipo.includes('queja')) tipoDetectado = 'Queja';
    else if (rawTipo.includes('soporte')) tipoDetectado = 'Soporte Técnico';
    else if (rawTipo.includes('sugerencia')) tipoDetectado = 'Sugerencia';
    else tipoDetectado = 'Petición';
  } else if (/reclamo|averia|defecto/i.test(textoExtraido)) {
    tipoDetectado = 'Reclamo';
  } else if (/queja|inconformidad|demora/i.test(textoExtraido)) {
    tipoDetectado = 'Queja';
  } else if (/soporte|falla|error|sistema|caido|alarma|sensor/i.test(textoExtraido)) {
    tipoDetectado = 'Soporte Técnico';
  } else if (/sugerencia|mejora|sugerimos/i.test(textoExtraido)) {
    tipoDetectado = 'Sugerencia';
  }

  let prioridadDetectada = 'Media';
  if (prioMatch) {
    const rawPrio = prioMatch[1].toLowerCase();
    if (rawPrio.includes('crit')) prioridadDetectada = 'Crítica';
    else if (rawPrio.includes('alta')) prioridadDetectada = 'Alta';
    else if (rawPrio.includes('baja')) prioridadDetectada = 'Baja';
    else prioridadDetectada = 'Media';
  } else if (/urgente|inmediato|critico|bloqueante/i.test(textoExtraido)) {
    prioridadDetectada = 'Alta';
  } else if (tipoDetectado === 'Reclamo') {
    prioridadDetectada = 'Alta';
  } else if (tipoDetectado === 'Sugerencia') {
    prioridadDetectada = 'Baja';
  }

  const nombreExtraido = nombreMatch ? nombreMatch[1].trim() : 'Ciudadano por Verificar';
  const depto = clasificarDepartamento(nombreArchivo, textoExtraido, tipoDetectado);

  const camposCompletos = Boolean(nombreMatch && emailMatch && telMatch);
  const scoreBase = camposCompletos ? 0.88 : 0.72;

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
      nombre: nombreMatch ? 0.90 : 0.40,
      email: emailMatch ? 0.95 : 0.30,
      telefono: telMatch ? 0.90 : 0.30,
      tipo_solicitud: tipoExplicitMatch ? 0.92 : 0.75,
      prioridad_sugerida: prioMatch ? 0.90 : 0.70,
      asunto: asuntoMatch ? 0.85 : 0.60,
      descripcion: 0.80,
    },
    datos_extraidos: {
      nombre_solicitante: nombreExtraido,
      email_solicitante: emailMatch ? emailMatch[0] : '',
      telefono_solicitante: telMatch ? telMatch[0] : '',
      tipo_solicitud: tipoDetectado,
      prioridad_sugerida: prioridadDetectada,
      area_sugerida: depto,
      asunto: asuntoMatch ? asuntoMatch[1].trim() : `Digitalización física: ${nombreArchivo || 'Formulario PQRS'}`,
      descripcion: textoExtraido.length > 20
        ? `[Transcripción Formulario]: ${textoExtraido.slice(0, 500)}`
        : 'Formulario físico digitalizado pendiente de confirmación manual de contenido por el agente.',
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

  // Si no hay API Key de Gemini configurada, conmutar inmediatamente a Plan B
  if (!geminiApiKey) {
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
  "descripcion": "Transcripción clara y detallada de la solicitud o motivo del reporte",
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
4. NO agregues texto conversacional fuera del JSON.
`;

    // Invocación a Gemini Vision con soporte multimodal y fallback secuencial de modelos
    const modelos = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
    let response = null;
    let modeloExitoso = 'gemini-2.0-flash';

    for (const mod of modelos) {
      try {
        response = await conTimeout(
          ai.models.generateContent({
            model: mod,
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
          }),
          12000
        );
        if (response && response.text) {
          modeloExitoso = mod;
          break;
        }
      } catch (modErr) {
        // Continuar al siguiente modelo disponible
      }
    }

    if (!response || !response.text) {
      throw new Error('Ningún modelo multimodal en la nube respondió satisfactoriamente');
    }

    const rawOutput = response.text || '';
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
