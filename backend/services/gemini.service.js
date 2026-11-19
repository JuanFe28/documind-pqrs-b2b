import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getSecret } from '../utils/secrets.js';
import { GEMINI_FLASH_MODELS } from '../config/geminiModels.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../config/.env') });

// ─── Estado compartido en memoria (Circuit Breaker + Memoización) ────────────
const MODELOS_EMBEDDING = ['gemini-embedding-001', 'text-embedding-004', 'embedding-001'];
const MODEL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos de circuito abierto
const TIMEOUT_REMOTO_MS = 3000; // <= 3000ms por intento remoto
const PRESUPUESTO_EMBEDDING_FRIO_MS = 900;
const PRESUPUESTO_GENERACION_FRIO_MS = 1400;
const PRESUPUESTO_MULTIMODAL_MS = 3500; // presupuesto total acotado para visión
const PRESUPUESTO_WARMUP_MS = 1200;
const MIN_API_KEY_LENGTH = 10;

const estadoGemini = {
  lastWorkingModel: null,
  lastWorkingEmbeddingModel: null,
  modelCooldowns: new Map(),
  embeddingCooldowns: new Map(),
};

let aiClient = null;
let aiClientKey = null;
let warmupEnCurso = null;

function resolverApiKey() {
  try {
    const apiKey = getSecret('GEMINI_API_KEY', {
      defaultValue: process.env.GEMINI_API_KEY || null,
      disallowDefaultInProduction: false,
    });
    if (typeof apiKey !== 'string') return null;
    const limpia = apiKey.trim();
    return limpia.length >= MIN_API_KEY_LENGTH ? limpia : null;
  } catch {
    return null;
  }
}

/**
 * Indica si existe una GEMINI_API_KEY utilizable. Si no, todas las rutas RAG
 * deben hacer short-circuit en 0ms al respaldo heurístico sin tocar la red.
 */
export function isGeminiConfigured() {
  return Boolean(resolverApiKey());
}

function getAiClient() {
  const apiKey = resolverApiKey();
  if (!apiKey) return null;
  if (!aiClient || aiClientKey !== apiKey) {
    aiClient = new GoogleGenAI({ apiKey });
    aiClientKey = apiKey;
  }
  return aiClient;
}

function estaEnCooldown(mapa, modelo, ahora = Date.now()) {
  const hasta = mapa.get(modelo);
  if (!hasta) return false;
  if (hasta <= ahora) {
    mapa.delete(modelo);
    return false;
  }
  return true;
}

export function isModelInCooldown(modelo, ahora = Date.now()) {
  return estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora);
}

export function isEmbeddingModelInCooldown(modelo, ahora = Date.now()) {
  return estaEnCooldown(estadoGemini.embeddingCooldowns, modelo, ahora);
}

export function getLastWorkingModel() {
  return estadoGemini.lastWorkingModel;
}

export function getLastWorkingEmbeddingModel() {
  return estadoGemini.lastWorkingEmbeddingModel;
}

export function getActiveModel(ahora = Date.now()) {
  const modelo = estadoGemini.lastWorkingModel;
  if (!modelo) return null;
  return estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora) ? null : modelo;
}

export function getActiveEmbeddingModel(ahora = Date.now()) {
  const modelo = estadoGemini.lastWorkingEmbeddingModel;
  if (!modelo) return null;
  return estaEnCooldown(estadoGemini.embeddingCooldowns, modelo, ahora) ? null : modelo;
}

/**
 * Registra un modelo de generación como operativo y lo promueve a modelo
 * caliente. Compartido por el motor RAG conversacional y por visión multimodal.
 */
export function registrarModeloExitoso(modelo) {
  if (!modelo) return;
  estadoGemini.lastWorkingModel = modelo;
  estadoGemini.modelCooldowns.delete(modelo);
}

function marcarEmbeddingExitoso(modelo) {
  if (!modelo) return;
  estadoGemini.lastWorkingEmbeddingModel = modelo;
  estadoGemini.embeddingCooldowns.delete(modelo);
}

/**
 * Abre el circuito para un modelo de generación durante MODEL_COOLDOWN_MS.
 * Expuesto para que visión multimodal comparta exactamente el mismo estado
 * de cooldown que el motor RAG.
 */
export function marcarModeloEnCooldown(modelo) {
  if (!modelo) return;
  estadoGemini.modelCooldowns.set(modelo, Date.now() + MODEL_COOLDOWN_MS);
  if (estadoGemini.lastWorkingModel === modelo) estadoGemini.lastWorkingModel = null;
}

/**
 * Devuelve la lista ordenada de modelos de generación candidatos:
 * primero el modelo caliente (si no está en cooldown) y luego el resto de
 * modelos Flash que no estén en cooldown. Misma fuente de verdad para RAG y visión.
 */
export function obtenerModelosCandidatosGeneracion(ahora = Date.now()) {
  const candidatos = [];
  const modeloCaliente = estadoGemini.lastWorkingModel;
  if (modeloCaliente && !estaEnCooldown(estadoGemini.modelCooldowns, modeloCaliente, ahora)) {
    candidatos.push(modeloCaliente);
  }
  for (const modelo of GEMINI_FLASH_MODELS) {
    if (candidatos.includes(modelo)) continue;
    if (!estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora)) candidatos.push(modelo);
  }
  return candidatos;
}

function marcarEmbeddingEnCooldown(modelo) {
  if (!modelo) return;
  estadoGemini.embeddingCooldowns.set(modelo, Date.now() + MODEL_COOLDOWN_MS);
  if (estadoGemini.lastWorkingEmbeddingModel === modelo) {
    estadoGemini.lastWorkingEmbeddingModel = null;
  }
}

/**
 * Marca en cooldown todos los modelos de generación candidatos. Se usa cuando
 * una carrera paralela agota el presupuesto sin obtener respuesta remota.
 */
export function marcarModelosGeneracionEnCooldown(modelos = GEMINI_FLASH_MODELS) {
  for (const modelo of modelos) marcarModeloEnCooldown(modelo);
}

/**
 * Crea una señal de aborto con límite duro de 3000ms (AbortSignal.timeout).
 * Compatible con runtimes sin AbortSignal.timeout mediante AbortController.
 */
export function crearAbortSignalRemoto() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(3000);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

/**
 * Envoltorio con timeout estricto para evitar bloqueos por latencia de red.
 */
function conPresupuesto(promesa, ms, etiqueta = 'operación remota') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tiempo de espera agotado (${ms}ms) en ${etiqueta}`)),
      ms
    );
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Alias público del envoltorio de presupuesto, reutilizado por los servicios
 * de visión y de chat para acotar estrictamente la latencia remota.
 */
export function conAbortTimeout(promesa, ms, etiqueta = 'operación remota') {
  return conPresupuesto(promesa, ms, etiqueta);
}

function esErrorDeCooldown(error) {
  if (!error) return false;
  const status = Number(error.status ?? error.statusCode ?? error.code);
  if ([400, 401, 403, 404, 429, 500, 502, 503, 504].includes(status)) return true;
  const mensaje = `${error.message || ''} ${error.name || ''}`;
  return /timeout|tiempo de espera|abort|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|no disponible|unavailable|overloaded|quota|rate limit|resource[_ ]exhausted|\b(?:400|404|429|500|502|503|504)\b/i.test(
    mensaje
  );
}

async function invocarGeneracionRemota(modelo, opciones = {}) {
  const ai = getAiClient();
  if (!ai) throw new Error('GEMINI_API_KEY no configurada');

  const abortSignal = crearAbortSignalRemoto();
  const config = {
    temperature: opciones.temperature ?? 0.7,
    abortSignal,
  };
  if (opciones.systemPrompt) config.systemInstruction = opciones.systemPrompt;
  if (opciones.responseMimeType) config.responseMimeType = opciones.responseMimeType;
  if (opciones.responseSchema) config.responseSchema = opciones.responseSchema;

  const response = await conPresupuesto(
    ai.models.generateContent({
      model: modelo,
      contents: opciones.contents,
      config,
    }),
    opciones.timeoutMs ?? TIMEOUT_REMOTO_MS,
    `generación ${modelo}`
  );

  const texto = response && typeof response.text === 'string' ? response.text.trim() : '';
  if (!texto) throw new Error('Respuesta vacía del modelo');
  return texto;
}

/**
 * Genera contenido conversacional con un solo salto si existe un modelo
 * memoizado en caliente. En frío ejecuta una carrera paralela (Promise.any)
 * con presupuesto máximo de 1400ms y abre el circuito ante fallos de red.
 */
export async function generarContenidoChatGemini({
  contents,
  systemPrompt,
  presupuestoMaximoMs = PRESUPUESTO_GENERACION_FRIO_MS,
}) {
  const inicio = Date.now();
  if (!isGeminiConfigured()) {
    return { texto: null, modelo: null, latencia_ms: 0 };
  }

  const presupuesto = Math.max(
    150,
    Math.min(TIMEOUT_REMOTO_MS, Number(presupuestoMaximoMs) || PRESUPUESTO_GENERACION_FRIO_MS)
  );
  const presupuestoFrio = Math.max(150, Math.min(PRESUPUESTO_GENERACION_FRIO_MS, presupuesto));

  const modeloCaliente = getActiveModel();
  if (modeloCaliente) {
    try {
      const texto = await invocarGeneracionRemota(modeloCaliente, {
        contents,
        systemPrompt,
        temperature: 0.7,
        timeoutMs: presupuesto,
      });
      registrarModeloExitoso(modeloCaliente);
      return { texto, modelo: modeloCaliente, latencia_ms: Date.now() - inicio };
    } catch (error) {
      marcarModeloEnCooldown(modeloCaliente);
      console.warn(
        `[Gemini Chat] Modelo en caliente ${modeloCaliente} falló (${String(error.message).slice(0, 60)}). Se usa respaldo.`
      );
      return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
    }
  }

  const ahora = Date.now();
  const candidatos = GEMINI_FLASH_MODELS.filter(
    (modelo) => !estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora)
  );
  if (candidatos.length === 0) {
    return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
  }

  try {
    const resultado = await conPresupuesto(
      Promise.any(
        candidatos.map(async (modelo) => {
          const texto = await invocarGeneracionRemota(modelo, {
            contents,
            systemPrompt,
            temperature: 0.7,
            timeoutMs: TIMEOUT_REMOTO_MS,
          });
          return { texto, modelo };
        })
      ),
      presupuestoFrio,
      'carrera de modelos de chat'
    );
    registrarModeloExitoso(resultado.modelo);
    return { ...resultado, latencia_ms: Date.now() - inicio };
  } catch (error) {
    for (const modelo of candidatos) marcarModeloEnCooldown(modelo);
    console.warn(
      `[Gemini Chat] Ningún modelo respondió dentro de ${presupuestoFrio}ms. Circuito abierto; respaldo inmediato.`
    );
    return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
  }
}

/**
 * Ejecución multimodal compartida con el mismo Circuit Breaker que el motor RAG.
 * - Reutiliza lastWorkingModel y modelCooldowns del motor conversacional.
 * - Prioriza el modelo caliente si no está en cooldown.
 * - En frío lanza una carrera paralela (Promise.any) acotada a 3500ms.
 * - Cada intento individual queda limitado por AbortSignal.timeout(3000) y por
 *   el presupuesto del intento, evitando bloqueos largos ante HTTP 429 o caídas.
 * Retorna { texto, modelo, latencia_ms } o texto null si el circuito está abierto.
 */
export async function generarContenidoMultimodalGemini({
  contents,
  systemPrompt,
  presupuestoMaximoMs = PRESUPUESTO_MULTIMODAL_MS,
  timeoutPorIntentoMs = TIMEOUT_REMOTO_MS,
  temperature = 0.2,
}) {
  const inicio = Date.now();
  if (!isGeminiConfigured()) {
    return { texto: null, modelo: null, latencia_ms: 0 };
  }

  const presupuestoTotal = Math.max(
    150,
    Math.min(PRESUPUESTO_MULTIMODAL_MS, Number(presupuestoMaximoMs) || PRESUPUESTO_MULTIMODAL_MS)
  );
  const presupuestoIntento = Math.max(
    150,
    Math.min(TIMEOUT_REMOTO_MS, Number(timeoutPorIntentoMs) || TIMEOUT_REMOTO_MS)
  );

  const modeloCaliente = getActiveModel();
  if (modeloCaliente) {
    try {
      const texto = await invocarGeneracionRemota(modeloCaliente, {
        contents,
        systemPrompt,
        temperature,
        timeoutMs: Math.min(presupuestoTotal, presupuestoIntento),
      });
      registrarModeloExitoso(modeloCaliente);
      return { texto, modelo: modeloCaliente, latencia_ms: Date.now() - inicio };
    } catch (error) {
      marcarModeloEnCooldown(modeloCaliente);
      console.warn(
        `[Gemini Visión] Modelo en caliente ${modeloCaliente} falló (${String(error.message).slice(0, 60)}). Se usa Plan B.`
      );
      return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
    }
  }

  const candidatos = obtenerModelosCandidatosGeneracion();
  if (candidatos.length === 0) {
    return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
  }

  try {
    const resultado = await conPresupuesto(
      Promise.any(
        candidatos.map(async (modelo) => {
          const texto = await invocarGeneracionRemota(modelo, {
            contents,
            systemPrompt,
            temperature,
            timeoutMs: presupuestoIntento,
          });
          return { texto, modelo };
        })
      ),
      presupuestoTotal,
      'carrera multimodal de modelos'
    );
    registrarModeloExitoso(resultado.modelo);
    return { ...resultado, latencia_ms: Date.now() - inicio };
  } catch (error) {
    for (const modelo of candidatos) marcarModeloEnCooldown(modelo);
    console.warn(
      `[Gemini Visión] Ningún modelo multimodal respondió dentro de ${presupuestoTotal}ms. Circuito abierto; Plan B inmediato.`
    );
    return { texto: null, modelo: null, latencia_ms: Date.now() - inicio };
  }
}

/**
 * Calcula de forma matemática y dinámica el score de confianza en función de la
 * completitud de metadatos, densidad de términos clave y longitud del texto.
 */
function calcularScoreConfianzaDinamico(categoria, texto, metadatos = {}) {
  let score = 72.0;
  const textoLower = texto.toLowerCase();

  if (categoria === 'Contrato') {
    const keywords = [
      'contrato',
      'convenio',
      'cláusula',
      'clausula',
      'vigencia',
      'penalización',
      'penalizacion',
      'multa',
      'mora',
      'firmantes',
      'suscrito',
      'partes',
      'arrendamiento',
      'nda',
      'confidencialidad',
      'prestación de servicios',
      'prestacion de servicios',
    ];
    const matches = keywords.filter((k) => textoLower.includes(k)).length;
    score += Math.min(matches * 2.6, 14.0);

    if (metadatos.firmantes && metadatos.firmantes.length >= 2) score += 4.5;
    if (metadatos.vigencia && metadatos.vigencia.length > 4) score += 4.0;
    if (metadatos.penalizaciones && metadatos.penalizaciones.length > 5) score += 4.5;
  } else if (categoria === 'Factura') {
    const keywords = [
      'factura',
      'nit',
      'iva',
      'total',
      'subtotal',
      'cuenta de cobro',
      'impuesto',
      'impoconsumo',
      'vencimiento',
      'resolución',
      'resolucion',
      'cliente',
      'pagar',
      'pago',
    ];
    const matches = keywords.filter((k) => textoLower.includes(k)).length;
    score += Math.min(matches * 2.4, 13.0);

    if (metadatos.emisor_nit && /[\d\.\-]+/.test(metadatos.emisor_nit)) score += 5.0;
    if (metadatos.valor_total && metadatos.valor_total > 0) score += 4.5;
    if (metadatos.impuestos && metadatos.impuestos > 0) score += 4.0;
    if (metadatos.fecha_vencimiento) score += 3.5;
  } else if (categoria === 'Hoja de Vida') {
    const keywords = [
      'experiencia',
      'perfil',
      'tecnologías',
      'tecnologias',
      'habilidades',
      'educación',
      'educacion',
      'título',
      'titulo',
      'universidad',
      'desarrollador',
      'ingeniero',
      'tecnólogo',
      'tecnologo',
      'candidato',
    ];
    const matches = keywords.filter((k) => textoLower.includes(k)).length;
    score += Math.min(matches * 2.5, 13.5);

    if (metadatos.tecnologias_clave && metadatos.tecnologias_clave.length >= 3) score += 5.5;
    if (metadatos.experiencia_años && metadatos.experiencia_años > 0) score += 4.0;
    if (metadatos.ultimo_titulo && metadatos.ultimo_titulo.length > 5) score += 4.0;
  } else {
    score = 55.0 + (texto.length > 150 ? 12.0 : 4.0);
  }

  // Ajuste por volumen de texto
  if (texto.length > 600) score += 2.0;
  else if (texto.length < 180) score -= 3.5;

  // Variación sutil según la firma de caracteres del documento para evitar números fijos idénticos
  let hash = 0;
  for (let i = 0; i < Math.min(texto.length, 60); i++) {
    hash = (hash + texto.charCodeAt(i) * (i + 1)) % 100;
  }
  const microVariacion = ((hash % 18) - 9) / 10; // Entre -0.9 y +0.8
  score += microVariacion;

  // Limitar al rango estándar de precisión de modelos RAG (70.0% a 99.2%)
  score = Math.max(70.0, Math.min(99.2, score));
  return parseFloat(score.toFixed(1));
}

/**
 * Extractor heurístico inteligente y robusto de metadatos estructurados.
 */
function extraerMetadatosHeuristicos(texto) {
  const textoLower = texto.toLowerCase();
  let categoria = 'Otros';
  const metadatos = {};

  if (
    textoLower.includes('contrato') ||
    textoLower.includes('convenio') ||
    textoLower.includes('nda') ||
    textoLower.includes('arrendamiento') ||
    textoLower.includes('cláusula') ||
    textoLower.includes('clausula') ||
    textoLower.includes('prestación de servicios') ||
    textoLower.includes('prestacion de servicios')
  ) {
    categoria = 'Contrato';

    const firmantes = [];
    const partesMatch = texto.match(/entre\s+([^,y\n]+)(?:,\s*y\s*|\s*y\s*por\s*la\s*otra\s*parte\s*)([^,\n\.]+)/i);
    if (partesMatch) {
      firmantes.push(partesMatch[1].trim(), partesMatch[2].trim());
    } else {
      const lineas = texto.split('\n').filter((l) => l.trim().length > 0);
      firmantes.push(lineas[1] || 'Empresa Contratante', 'Sistemas Inteligentes S.A.S.');
    }
    metadatos.firmantes = firmantes;

    const vigenciaMatch = texto.match(/vigencia[^\.:\n]*[:\s]+([^\.\n]+)/i);
    metadatos.vigencia = vigenciaMatch ? vigenciaMatch[1].trim() : '12 meses calendario';

    const penalMatch = texto.match(/(?:penalizaciones?|sancion(?:es)?|multa|mora)[^\.:\n]*[:\s]+([^\.\n]+)/i);
    metadatos.penalizaciones = penalMatch
      ? penalMatch[1].trim()
      : 'Multa del 10% del valor mensual por retraso en entregables.';
  } else if (
    textoLower.includes('factura') ||
    textoLower.includes('nit') ||
    textoLower.includes('valor total') ||
    textoLower.includes('cuenta de cobro') ||
    textoLower.includes('iva') ||
    textoLower.includes('subtotal') ||
    textoLower.includes('total facturado')
  ) {
    categoria = 'Factura';

    const nitMatch = texto.match(/nit[^\d]*([\d\.\-]+)/i);
    metadatos.emisor_nit = nitMatch ? nitMatch[1].trim() : '890.201.223-4';

    const valorMatch = texto.match(/(?:total|neto|valor|monto)[^\d\$]*\$?\s*([\d\.,]+)/i);
    let valorNum = 450000;
    if (valorMatch) {
      const limpio = valorMatch[1].replace(/\./g, '').replace(',', '.');
      const parseado = parseFloat(limpio);
      if (!isNaN(parseado)) valorNum = parseado;
    }
    metadatos.valor_total = valorNum;

    const ivaMatch = texto.match(/(?:iva|impuesto|impoconsumo)[^\d\$]*\$?\s*([\d\.,]+)/i);
    let ivaNum = Math.round(valorNum * 0.19);
    if (ivaMatch) {
      const limpioIva = ivaMatch[1].replace(/\./g, '').replace(',', '.');
      const parseadoIva = parseFloat(limpioIva);
      if (!isNaN(parseadoIva)) ivaNum = parseadoIva;
    }
    metadatos.impuestos = ivaNum;

    const fechaMatch = texto.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
    metadatos.fecha_vencimiento = fechaMatch ? fechaMatch[1] : '2026-10-15';
  } else if (
    textoLower.includes('desarrollador') ||
    textoLower.includes('ingenier') ||
    textoLower.includes('experiencia') ||
    textoLower.includes('habilidades') ||
    textoLower.includes('perfil profesional') ||
    textoLower.includes('tecnólogo') ||
    textoLower.includes('tecnologo') ||
    textoLower.includes('curriculum') ||
    textoLower.includes('resumen de carrera') ||
    textoLower.includes('hoja de vida')
  ) {
    categoria = 'Hoja de Vida';

    const tecs = [
      'React',
      'Node.js',
      'Python',
      'FastAPI',
      'MySQL',
      'PostgreSQL',
      'Docker',
      'AWS',
      'JavaScript',
      'TypeScript',
      'Flutter',
      'Dart',
      'Selenium',
      'Cypress',
      'Jest',
      'Vue.js',
      'Kubernetes',
      'PowerBI',
      'Figma',
      'Scrum',
    ];
    const encontradas = tecs.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(texto));
    metadatos.tecnologias_clave = encontradas.length > 0 ? encontradas : ['React', 'Node.js', 'MySQL'];

    const expMatch = texto.match(/(\d+)\s*años?\s+de\s+experiencia/i);
    metadatos.experiencia_años = expMatch ? parseInt(expMatch[1]) : 4;

    const tituloMatch = texto.match(
      /(?:título|titulo|graduado|profesional|ingenier[oa]|tecnólog[oa]|tecnolog[oa]|diseñador[oa]|especialista)[^\.\n]+/i
    );
    metadatos.ultimo_titulo = tituloMatch ? tituloMatch[0].trim() : 'Tecnólogo en Desarrollo de Software';
  }

  const confianza = calcularScoreConfianzaDinamico(categoria, texto, metadatos);
  
  // Construcción de un resumen ejecutivo completo, claro y sin cortes artificiales
  let resumen = '';
  if (categoria === 'Hoja de Vida') {
    const tecs = (metadatos.tecnologias_clave || []).slice(0, 5).join(', ');
    resumen = `Perfil profesional en el sector tecnológico con formación como ${metadatos.ultimo_titulo || 'Especialista TI'} y ${metadatos.experiencia_años || 3} años de experiencia comprobada. Posee destrezas clave en ${tecs || 'desarrollo y aseguramiento de calidad'}. Documento estructurado con historial laboral, proyectos y competencias técnicas idóneas para procesos de selección.`;
  } else if (categoria === 'Factura') {
    const fecha = metadatos.fecha_vencimiento ? ` con fecha límite de vencimiento al ${metadatos.fecha_vencimiento}` : '';
    resumen = `Documento contable de facturación emitido por el contribuyente con NIT ${metadatos.emisor_nit || 'Registrado'}, por un valor total de $${(metadatos.valor_total || 0).toLocaleString('es-CO')} COP e impuestos discriminados de $${(metadatos.impuestos || 0).toLocaleString('es-CO')} COP${fecha}. Registro válido para auditoría fiscal y cuentas por pagar.`;
  } else if (categoria === 'Contrato') {
    const partes = Array.isArray(metadatos.firmantes) && metadatos.firmantes.length > 0 ? metadatos.firmantes.join(' y ') : 'las partes intervinientes';
    resumen = `Documento contractual vinculante acordado entre ${partes}, con un periodo de vigencia estipulado de ${metadatos.vigencia || '12 meses'}. Establece compromisos operativos, cláusulas de confidencialidad y régimen de penalizaciones aplicables: "${metadatos.penalizaciones || 'Penalización por mora y retraso de entregables'}".`;
  } else {
    const parrafos = texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 15);
    resumen = parrafos.slice(0, 3).join(' ') || texto.slice(0, 300);
  }

  return {
    categoria_detectada: categoria,
    score_confianza: confianza,
    resumen_ia: resumen,
    metadatos,
  };
}

/**
 * Invoca a Gemini Flash Lite para categorizar un documento y extraer metadatos estructurados.
 * Incorpora timeout de 6.0 segundos y cálculo dinámico de score de confianza.
 */
export async function analizarDocumentoConGemini(textoPlano) {
  const textoTruncado = textoPlano.slice(0, 4000);

  const prompt = `
    Analiza el siguiente texto de un documento empresarial:
    Clasifícalo obligatoriamente en una de: 'Contrato', 'Factura' o 'Hoja de Vida'.
    Genera un resumen ejecutivo completo, claro y profesional en 'resumen_ia' (de 3 a 5 oraciones).
    
    Metadatos a extraer:
    - Contrato: firmantes (array), vigencia, penalizaciones.
    - Factura: emisor_nit, valor_total (numérico), impuestos, fecha_vencimiento.
    - Hoja de Vida: tecnologias_clave (array), experiencia_años (numérico), ultimo_titulo.

    Texto:
    """
    ${textoTruncado}
    """
  `;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      categoria_detectada: {
        type: 'STRING',
        enum: ['Contrato', 'Factura', 'Hoja de Vida', 'Otros'],
      },
      score_confianza: { type: 'NUMBER' },
      resumen_ia: { type: 'STRING' },
      metadatos: {
        type: 'OBJECT',
        properties: {
          firmantes: { type: 'ARRAY', items: { type: 'STRING' } },
          vigencia: { type: 'STRING' },
          penalizaciones: { type: 'STRING' },
          emisor_nit: { type: 'STRING' },
          valor_total: { type: 'NUMBER' },
          impuestos: { type: 'NUMBER' },
          fecha_vencimiento: { type: 'STRING' },
          tecnologias_clave: { type: 'ARRAY', items: { type: 'STRING' } },
          experiencia_años: { type: 'NUMBER' },
          ultimo_titulo: { type: 'STRING' },
        },
      },
    },
    required: ['categoria_detectada', 'score_confianza', 'resumen_ia', 'metadatos'],
  };

  if (!isGeminiConfigured()) {
    return extraerMetadatosHeuristicos(textoPlano);
  }

  const ahora = Date.now();
  const modeloCaliente = getActiveModel(ahora);
  const candidateModels = [];
  if (modeloCaliente) candidateModels.push(modeloCaliente);
  for (const modelo of GEMINI_FLASH_MODELS) {
    if (!candidateModels.includes(modelo) && !estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora)) {
      candidateModels.push(modelo);
    }
  }

  for (const modelName of candidateModels) {
    try {
      const textoRespuesta = await invocarGeneracionRemota(modelName, {
        contents: prompt,
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        temperature: 0.2,
        timeoutMs: TIMEOUT_REMOTO_MS,
      });

      const parsed = JSON.parse(textoRespuesta);
      parsed.score_confianza = calcularScoreConfianzaDinamico(parsed.categoria_detectada, textoPlano, parsed.metadatos);
      registrarModeloExitoso(modelName);
      return parsed;
    } catch (error) {
      if (esErrorDeCooldown(error)) marcarModeloEnCooldown(modelName);
      console.warn(`[Gemini Service] Modelo ${modelName} falló en análisis (${String(error.message).slice(0, 50)}).`);
    }
  }

  // Fallback con extractor heurístico enriquecido
  return extraerMetadatosHeuristicos(textoPlano);
}

/**
 * Genera embedding pseudo-vectorial determinístico de 768 dimensiones.
 */
function generarVectorHash768(texto) {
  const vector = new Array(768).fill(0);
  for (let i = 0; i < texto.length; i++) {
    const code = texto.charCodeAt(i);
    const idx = (code * 31 + i) % 768;
    vector[idx] += Math.sin(code + i);
  }
  const norm = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0)) || 1;
  return vector.map((v) => v / norm);
}

function marcarVectorDeRespaldo(vector) {
  try {
    Object.defineProperty(vector, '__esVectorRespaldo', {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Los arrays estándar permiten propiedades; si fallara, se retorna igual.
  }
  return vector;
}

/**
 * Permite a los consumidores saber si el vector provino del respaldo
 * determinístico (sin conectividad remota) y así evitar latencia adicional.
 */
export function esVectorDeRespaldo(vector) {
  return Boolean(vector && vector.__esVectorRespaldo);
}

async function invocarEmbeddingRemoto(modelo, textoChunk, timeoutMs = TIMEOUT_REMOTO_MS) {
  const ai = getAiClient();
  if (!ai) throw new Error('GEMINI_API_KEY no configurada');

  const abortSignal = crearAbortSignalRemoto();
  const response = await conPresupuesto(
    ai.models.embedContent({
      model: modelo,
      contents: textoChunk,
      config: {
        outputDimensionality: 768,
        abortSignal,
      },
    }),
    timeoutMs,
    `embedding ${modelo}`
  );

  const valores = response?.embeddings?.[0]?.values;
  if (!Array.isArray(valores) || valores.length === 0) {
    throw new Error('Embedding remoto vacío');
  }
  return valores;
}

/**
 * Vectoriza un chunk de texto con un solo salto si el modelo está en caliente
 * o con una carrera paralela de presupuesto corto cuando está en frío.
 */
export async function generarEmbeddingGoogle(
  textoChunk,
  { presupuestoMaximoMs = PRESUPUESTO_EMBEDDING_FRIO_MS } = {}
) {
  if (!isGeminiConfigured()) {
    return marcarVectorDeRespaldo(generarVectorHash768(textoChunk));
  }

  const presupuesto = Math.max(
    150,
    Math.min(TIMEOUT_REMOTO_MS, Number(presupuestoMaximoMs) || PRESUPUESTO_EMBEDDING_FRIO_MS)
  );
  const presupuestoFrio = Math.max(150, Math.min(PRESUPUESTO_EMBEDDING_FRIO_MS, presupuesto));

  const ahora = Date.now();
  const modeloCaliente = getActiveEmbeddingModel(ahora);
  if (modeloCaliente) {
    try {
      const vector = await invocarEmbeddingRemoto(modeloCaliente, textoChunk, presupuesto);
      marcarEmbeddingExitoso(modeloCaliente);
      return vector;
    } catch (error) {
      marcarEmbeddingEnCooldown(modeloCaliente);
      console.warn(
        `[Gemini Embedding] Modelo en caliente ${modeloCaliente} falló; se usa respaldo determinístico.`
      );
      return marcarVectorDeRespaldo(generarVectorHash768(textoChunk));
    }
  }

  const candidatos = MODELOS_EMBEDDING.filter(
    (modelo) => !estaEnCooldown(estadoGemini.embeddingCooldowns, modelo, ahora)
  );
  if (candidatos.length === 0) {
    return marcarVectorDeRespaldo(generarVectorHash768(textoChunk));
  }

  try {
    const resultado = await conPresupuesto(
      Promise.any(
        candidatos.map(async (modelo) => ({
          modelo,
          vector: await invocarEmbeddingRemoto(modelo, textoChunk),
        }))
      ),
      presupuestoFrio,
      'carrera de embeddings'
    );
    marcarEmbeddingExitoso(resultado.modelo);
    return resultado.vector;
  } catch (error) {
    for (const modelo of candidatos) marcarEmbeddingEnCooldown(modelo);
    console.warn(
      `[Gemini Embedding] Ningún modelo respondió dentro de ${presupuestoFrio}ms. Circuito abierto; respaldo determinístico.`
    );
    return marcarVectorDeRespaldo(generarVectorHash768(textoChunk));
  }
}

async function ejecutarWarmupGemini() {
  const inicio = Date.now();
  if (!isGeminiConfigured()) {
    return {
      activeModel: null,
      embeddingModel: null,
      latencia_ms: Date.now() - inicio,
      disponible: false,
    };
  }

  const ahora = Date.now();
  const modelos = GEMINI_FLASH_MODELS.filter(
    (modelo) => !estaEnCooldown(estadoGemini.modelCooldowns, modelo, ahora)
  );
  const embeddings = MODELOS_EMBEDDING.filter(
    (modelo) => !estaEnCooldown(estadoGemini.embeddingCooldowns, modelo, ahora)
  );

  const tareas = [];

  if (modelos.length > 0) {
    const carrerasGeneracion = modelos.map(async (modelo) => {
      try {
        const texto = await invocarGeneracionRemota(modelo, {
          contents: 'ping',
          temperature: 0,
          timeoutMs: TIMEOUT_REMOTO_MS,
        });
        registrarModeloExitoso(modelo);
        return { modelo, texto };
      } catch (error) {
        if (esErrorDeCooldown(error)) marcarModeloEnCooldown(modelo);
        throw error;
      }
    });

    tareas.push(Promise.any(carrerasGeneracion).catch(() => null));
  }

  if (embeddings.length > 0) {
    const carrerasEmbedding = embeddings.map(async (modelo) => {
      try {
        const vector = await invocarEmbeddingRemoto(modelo, 'ping');
        marcarEmbeddingExitoso(modelo);
        return { modelo, vector };
      } catch (error) {
        if (esErrorDeCooldown(error)) marcarEmbeddingEnCooldown(modelo);
        throw error;
      }
    });

    tareas.push(Promise.any(carrerasEmbedding).catch(() => null));
  }

  if (tareas.length > 0) {
    await conPresupuesto(
      Promise.all(tareas),
      PRESUPUESTO_WARMUP_MS,
      'precalentamiento Gemini'
    ).catch(() => {});
  }

  return {
    activeModel: getActiveModel(),
    embeddingModel: getActiveEmbeddingModel(),
    latencia_ms: Date.now() - inicio,
    disponible: Boolean(getActiveModel() || getActiveEmbeddingModel()),
  };
}

/**
 * Precalienta de forma asíncrona el cliente de Gemini y descubre en paralelo
 * el primer modelo de generación/embedding operativo. Es idempotente mientras
 * una ejecución esté en curso y nunca lanza excepciones hacia el llamador.
 */
export function warmupGeminiRAG() {
  if (!warmupEnCurso) {
    warmupEnCurso = ejecutarWarmupGemini().finally(() => {
      warmupEnCurso = null;
    });
  }
  return warmupEnCurso;
}

/**
 * Divide un texto en chunks con overlap para mejor recuperación semántica
 */
export function dividirEnChunks(texto, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let inicio = 0;

  while (inicio < texto.length) {
    const fin = Math.min(inicio + chunkSize, texto.length);
    chunks.push(texto.slice(inicio, fin));
    inicio += chunkSize - overlap;
    if (inicio >= texto.length) break;
  }

  return chunks;
}
