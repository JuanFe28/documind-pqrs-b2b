import crypto from 'crypto';
import fs from 'fs';
import {
  generarEmbeddingGoogle,
  generarContenidoChatGemini,
  esVectorDeRespaldo,
  getActiveModel,
} from '../services/gemini.service.js';
import { queryVectores } from '../services/pinecone.service.js';
import { procesarFormularioConVision } from '../services/vision.service.js';
import { registrarAccesoVision } from './vision.controller.js';
import db from '../config/db.js';

const PRESUPUESTO_VECTORIAL_MS = 250;
const PRESUPUESTO_VECTORIAL_AMPLIO_MS = 200;
const PRESUPUESTO_LEXICO_MS = 300;
const PRESUPUESTO_TOTAL_RAG_MS = 1350;
const PRESUPUESTO_MINIMO_GENERACION_MS = 200;

// Copiloto PQRS Context-Fusion
const ROLES_OPERATIVOS_COPILOTO = ['ADMIN', 'SUPERVISOR', 'AGENTE'];
const PRESUPUESTO_CONTEXTO_TICKET_MS = 450;
const PRESUPUESTO_GENERACION_COPILOTO_MS = 1300;
const SECCION_DIAGNOSTICO = '### Diagnóstico Operativo y Severidad SLA';
const SECCION_PASOS = '### Pasos Internos de Resolución';
const SECCION_BORRADOR = '### Borrador de Respuesta Formal al Ciudadano';
const CONDICION_REPO_NORMATIVA = "(r.id = 3 OR r.slug = 'normativa-pqrs' OR r.departamento = 'Normativa PQRS')";
const PALABRAS_VACIAS_NORMATIVA = new Set([
  'para', 'porque', 'desde', 'hasta', 'entre', 'sobre', 'cuando', 'donde', 'tiene', 'tienen',
  'este', 'esta', 'estos', 'estas', 'como', 'pero', 'solicitud', 'solicitante', 'ciudadano',
  'manera', 'forma', 'caso', 'casos', 'requiere', 'requerimiento', 'urgente', 'peticion',
]);

function conPresupuestoRapido(promesa, ms, etiqueta = 'operación RAG') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout tras ${ms}ms en ${etiqueta}`)), ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Generador contextual y dinámico de respaldo si no hay conectividad externa.
 */
function generarRespuestaAnaliticaRespaldo(match, query) {
  const texto = match ? match.metadata.text_chunk : '';
  const archivo = match ? match.metadata.nombre_archivo : '';
  const pag = match ? match.metadata.page_num : 1;
  const lower = (texto + ' ' + query).toLowerCase();

  if (match) {
    let tipo = 'Documento';
    let alternativas = [];

    if (lower.includes('experiencia') || lower.includes('perfil') || lower.includes('desarrollador') || lower.includes('qa') || lower.includes('ingenier') || archivo.toLowerCase().includes('cv')) {
      tipo = 'Perfil Profesional / Hoja de Vida';
      alternativas = [
        '**Evaluación Técnica:** Coordinar una prueba práctica o entrevista técnica enfocada en sus herramientas principales.',
        '**Validación de Experiencia:** Contrastar las referencias laborales y proyectos anteriores del postulante.',
        '**Alineación Salarial y Disponibilidad:** Verificar expectativas de compensación y fecha estimada de incorporación.',
      ];
    } else if (lower.includes('factura') || lower.includes('nit') || lower.includes('valor total') || lower.includes('pago')) {
      tipo = 'Factura / Documento Contable';
      alternativas = [
        '**Cruce con Orden de Compra:** Validar los ítems facturados con la orden de servicio o cotización aprobada.',
        '**Programación de Pago:** Registrar la fecha límite de vencimiento en tesorería para evitar cobros de mora.',
        '**Verificación Fiscal:** Comprobar la validez del NIT y el desglose de impuestos (IVA/Retenciones).',
      ];
    } else {
      tipo = 'Contrato / Documento Legal';
      alternativas = [
        '**Revisión de Cláusulas:** Analizar los compromisos, plazos y condiciones acordadas entre las partes.',
        '**Seguimiento de Entregables:** Monitorear el cumplimiento del cronograma y las obligaciones estipuladas.',
        '**Soporte Documental:** Archivar las actas de inicio y acuerdos complementarios en el repositorio.',
      ];
    }

    let resp = `### Análisis de ${tipo}: ${archivo}\n\n`;
    resp += `A partir de la información registrada en **${archivo}** (Pág. ${pag}):\n\n`;

    const lineas = texto
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 20)
      .slice(0, 5);

    if (lineas.length > 0) {
      lineas.forEach((l) => {
        resp += `> "${l}"\n\n`;
      });
    } else {
      resp += `> "${texto.slice(0, 300)}..."\n\n`;
    }

    resp += `#### Recomendaciones y Siguientes Pasos:\n`;
    alternativas.forEach((alt, idx) => {
      resp += `${idx + 1}. ${alt}\n`;
    });
    resp += `\n*(Fuente de consulta: ${archivo}, Pág. ${pag})*`;
    return resp;
  }

  // Respuesta a consulta abierta sin documento específico
  return `No he encontrado información relevante en los documentos cargados para responder a tu consulta.\n\n¡Hola! Soy **DocuMind**, tu asistente inteligente de gestión y análisis documental.\n\nPuedo ayudarte en tiempo real con:\n- **Análisis y comparación** de contratos, facturas y hojas de vida.\n- **Búsqueda contextual profunda** en todos tus repositorios empresariales.\n- **Recomendaciones estratégicas** y resolución de dudas técnicas, comerciales o legales.\n\n¿En qué documento o tema te gustaría que trabajemos ahora?`;
}

// ─── Copiloto PQRS Context-Fusion (Ticket + Adjuntos + Normativa oficial) ────

/**
 * Elimina cualquier pictograma Unicode (emojis) y normaliza espacios del texto
 * generado, garantizando respuestas limpias listas para copiar al modal PQRS.
 */
function sanearTextoCopiloto(texto) {
  return String(texto || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ejecutarConPresupuesto(fabrica, ms, etiqueta, respaldo) {
  let promesa;
  try {
    promesa = Promise.resolve().then(fabrica);
  } catch {
    return Promise.resolve(respaldo);
  }
  promesa.catch(() => {});
  return conPresupuestoRapido(promesa, ms, etiqueta).catch(() => respaldo);
}

function extraerTerminosNormativa(ticket, query) {
  const texto = [
    ticket?.tipo_solicitud,
    ticket?.tipo,
    ticket?.departamento,
    ticket?.asunto,
    ticket?.descripcion,
    ticket?.prioridad,
    query,
  ]
    .filter(Boolean)
    .join(' ');

  const normalizado = String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/);

  const terminos = [];
  for (const palabra of normalizado) {
    if (palabra.length < 4) continue;
    if (PALABRAS_VACIAS_NORMATIVA.has(palabra)) continue;
    if (!terminos.includes(palabra)) terminos.push(palabra);
    if (terminos.length >= 8) break;
  }
  return terminos;
}

async function buscarNormativaOficialTicket(ticket, query) {
  const terminos = extraerTerminosNormativa(ticket, query);
  const parametros = terminos.map((termino) => `%${termino}%`);
  const filtroLexico = terminos.length > 0
    ? ` AND (${terminos.map(() => 'c.texto_chunk ILIKE ?').join(' OR ')})`
    : '';

  const sqlLexico = `
    SELECT c.documento_id, c.chunk_index, c.texto_chunk, d.nombre_archivo, d.url_descarga,
           r.id AS repositorio_id
    FROM documentos_chunks c
    JOIN documentos d ON d.id = c.documento_id
    JOIN repositorios r ON r.id = d.repositorio_id
    WHERE ${CONDICION_REPO_NORMATIVA}${filtroLexico}
    ORDER BY c.documento_id ASC, c.chunk_index ASC
    LIMIT 4
  `;

  const filas = await db.query(sqlLexico, parametros);
  if (filas && filas.length > 0) return filas;

  // Sin coincidencias léxicas: citar los fragmentos base del 3.er repositorio oficial
  return db.query(
    `SELECT c.documento_id, c.chunk_index, c.texto_chunk, d.nombre_archivo, d.url_descarga,
            r.id AS repositorio_id
     FROM documentos_chunks c
     JOIN documentos d ON d.id = c.documento_id
     JOIN repositorios r ON r.id = d.repositorio_id
     WHERE ${CONDICION_REPO_NORMATIVA}
     ORDER BY d.id ASC, c.chunk_index ASC
     LIMIT 3`,
    []
  );
}

function calcularSeveridadSlaTicket(ticket) {
  const horas = Number.parseInt(ticket?.sla_horas, 10) || 24;
  const limiteMs = ticket?.sla_fecha_limite ? new Date(ticket.sla_fecha_limite).getTime() : NaN;

  if (!Number.isFinite(limiteMs)) {
    return {
      nivel: ticket?.es_urgente ? 'ALTA' : 'MEDIA',
      detalle: `Plazo comprometido de ${horas} horas. Registrar seguimiento dentro del turno actual.`,
    };
  }

  const restanteHoras = (limiteMs - Date.now()) / 3600000;
  if (restanteHoras < 0) {
    return {
      nivel: 'CRÍTICA',
      detalle: `El SLA de ${horas} horas está vencido hace ${Math.abs(restanteHoras).toFixed(1)} horas. Requiere escalamiento inmediato a Nivel 2.`,
    };
  }
  if (restanteHoras <= Math.max(2, horas * 0.25)) {
    return {
      nivel: 'ALTA',
      detalle: `Restan ${restanteHoras.toFixed(1)} horas para el vencimiento del SLA de ${horas} horas. Priorizar la gestión y documentar cada acción.`,
    };
  }
  return {
    nivel: ticket?.es_urgente ? 'ALTA' : 'MEDIA',
    detalle: `Restan ${restanteHoras.toFixed(1)} horas del SLA de ${horas} horas. La atención avanza dentro del plazo comprometido.`,
  };
}

function construirContextoUnificadoTicket(ticket, actividades, adjuntos, normativa) {
  const lineasActividades = (actividades || []).slice(0, 5).map((actividad, indice) => {
    const marca = actividad.es_nota_interna ? '[nota interna]' : '[público]';
    return `${indice + 1}. ${marca} ${actividad.autor_nombre || 'Sistema'} (${actividad.autor_tipo || 'SISTEMA'}): ${actividad.mensaje || ''}`;
  });

  const lineasAdjuntos = (adjuntos || []).map((adjunto) => {
    return `- ${adjunto.nombre_archivo || 'Adjunto sin nombre'} | categoría: ${adjunto.categoria_detectada || 'General'} | resumen: ${adjunto.resumen_ia || 'Sin resumen disponible'}`;
  });

  const lineasNormativa = (normativa || []).map((fragmento, indice) => {
    const cita = String(fragmento.texto_chunk || '').replace(/\s+/g, ' ').slice(0, 420);
    return `${indice + 1}. ${fragmento.nombre_archivo || 'Manual oficial'} (fragmento ${Number(fragmento.chunk_index || 0) + 1}): "${cita}"`;
  });

  return [
    `TICKET PQRS: ${ticket.ticket_id}`,
    `Estado: ${ticket.estado || 'NUEVO'} | Prioridad: ${ticket.prioridad || 'Media'} | Departamento: ${ticket.departamento || 'Sin asignar'}`,
    `SLA: ${ticket.sla_horas || 24} horas | Fecha límite: ${ticket.sla_fecha_limite || 'No registrada'} | Urgente: ${ticket.es_urgente ? 'Sí' : 'No'}`,
    `Tipo: ${ticket.tipo_solicitud || ticket.tipo || 'Petición'}`,
    `Asunto: ${ticket.asunto || 'Sin asunto'}`,
    `Descripción: ${ticket.descripcion || 'Sin descripción'}`,
    '',
    'ACTIVIDADES RECIENTES:',
    lineasActividades.length > 0 ? lineasActividades.join('\n') : '- Sin actividades registradas.',
    '',
    'DOCUMENTOS ADJUNTOS DEL CLIENTE:',
    lineasAdjuntos.length > 0 ? lineasAdjuntos.join('\n') : '- El ticket no registra adjuntos.',
    '',
    'NORMATIVA OFICIAL (Manuales, Normativa y Protocolos PQRS):',
    lineasNormativa.length > 0 ? lineasNormativa.join('\n') : '- Sin fragmentos normativos disponibles.',
  ].join('\n');
}

/**
 * Respaldo estructurado instantáneo del copiloto. Genera las mismas 3 secciones
 * del contrato de respuesta sin depender de conectividad ni de latencia remota.
 */
export function generarRespuestaCopilotoTicket({ ticket, actividades = [], adjuntos = [], normativa = [], query = '' }) {
  const severidad = calcularSeveridadSlaTicket(ticket);
  const adjuntoPrincipal = adjuntos[0] || null;
  const fragmentoPrincipal = normativa[0] || null;
  const citaNormativa = fragmentoPrincipal
    ? String(fragmentoPrincipal.texto_chunk || '').replace(/\s+/g, ' ').slice(0, 300)
    : '';
  const nombreProtocolo = fragmentoPrincipal?.nombre_archivo || 'Manuales, Normativa y Protocolos PQRS';
  const tipo = ticket.tipo_solicitud || ticket.tipo || 'Petición';
  const actividadReciente = (actividades || [])[0];

  let diagnostico = `El ticket ${ticket.ticket_id} corresponde a un caso de ${tipo} con prioridad ${ticket.prioridad || 'Media'} y estado ${ticket.estado || 'NUEVO'}. `;
  diagnostico += `El SLA comprometido es de ${ticket.sla_horas || 24} horas (fecha límite ${ticket.sla_fecha_limite || 'no registrada'}) y la severidad operativa calculada es ${severidad.nivel}. `;
  diagnostico += `${severidad.detalle} `;
  if (actividadReciente) {
    diagnostico += `Última actividad registrada por ${actividadReciente.autor_nombre || 'el sistema'}: ${String(actividadReciente.mensaje || '').slice(0, 220)}`;
    if (!/[.!?]$/.test(diagnostico.trim())) diagnostico += '.';
  }
  if (query) {
    diagnostico += ` Consulta del agente: ${query}`;
    if (!/[.!?]$/.test(diagnostico.trim())) diagnostico += '.';
  }

  const pasos = [
    `1. Verificar la trazabilidad del expediente ${ticket.ticket_id} y confirmar que la prioridad ${ticket.prioridad || 'Media'} coincide con el impacto reportado.`,
    `2. Aplicar el protocolo oficial "${nombreProtocolo}"${citaNormativa ? `: "${citaNormativa}"` : ''}`,
    adjuntoPrincipal
      ? `3. Revisar el adjunto del cliente "${adjuntoPrincipal.nombre_archivo}" y contrastar ${adjuntoPrincipal.resumen_ia ? `su resumen (${String(adjuntoPrincipal.resumen_ia).slice(0, 200)})` : 'su contenido'} con los hechos descritos.`
      : '3. Documentar en el timeline interno la ausencia de adjuntos y solicitar evidencia adicional si el caso lo requiere.',
    `4. Registrar la gestión en el área ${ticket.departamento || 'responsable'} y mantener el seguimiento dentro del plazo de ${ticket.sla_horas || 24} horas.`,
  ].join('\n');

  const borrador = [
    'Estimado(a) solicitante:',
    '',
    `Recibimos su solicitud radicada con el número ${ticket.ticket_id}, correspondiente a ${ticket.asunto || 'su requerimiento'}. El caso se encuentra en estado ${ticket.estado || 'NUEVO'} con prioridad ${ticket.prioridad || 'Media'} y ha sido asignado al área de ${ticket.departamento || 'atención PQRS'}, con un plazo de respuesta de ${ticket.sla_horas || 24} horas.`,
    '',
    adjuntoPrincipal
      ? `Confirmamos la recepción del documento adjunto "${adjuntoPrincipal.nombre_archivo}", el cual se encuentra vinculado a su expediente y será tenido en cuenta durante la gestión.`
      : 'Si cuenta con documentos o evidencias adicionales, puede adjuntarlos para complementar la gestión de su caso.',
    '',
    citaNormativa
      ? `La atención se adelantará conforme a la normativa institucional aplicable, en particular el protocolo "${nombreProtocolo}", que establece los criterios y plazos para este tipo de solicitudes.`
      : 'La atención se adelantará conforme a los protocolos institucionales y a los plazos comprometidos para su solicitud.',
    '',
    'Le informaremos oportunamente cualquier avance o requerimiento adicional a través de los canales oficiales de atención.',
    '',
    'Atentamente,',
    'Equipo de Atención PQRS',
  ].join('\n');

  return sanearTextoCopiloto(
    `${SECCION_DIAGNOSTICO}\n\n${diagnostico}\n\n${SECCION_PASOS}\n\n${pasos}\n\n${SECCION_BORRADOR}\n\n${borrador}`
  );
}

function normalizarRespuestaCopiloto(texto) {
  if (typeof texto !== 'string' || texto.trim().length === 0) return null;
  const limpio = sanearTextoCopiloto(texto);
  const completo = [SECCION_DIAGNOSTICO, SECCION_PASOS, SECCION_BORRADOR].every((seccion) =>
    limpio.includes(seccion)
  );
  return completo ? limpio : null;
}

function extraerBorradorRespuesta(respuesta) {
  const texto = String(respuesta || '');
  const indice = texto.indexOf(SECCION_BORRADOR);
  if (indice === -1) return '';
  return texto
    .slice(indice + SECCION_BORRADOR.length)
    .replace(/^[\s:\-]+/, '')
    .trim();
}

async function consultarContextoTicket(ticketId, query) {
  const tareaTicket = ejecutarConPresupuesto(
    () => db.query(
      `SELECT ticket_id, estado, prioridad, departamento, sla_horas, sla_fecha_limite, es_urgente,
              asunto, descripcion, tipo_solicitud, tipo, nombre_solicitante
       FROM pqrs_solicitudes
       WHERE ticket_id = ?
       LIMIT 1`,
      [ticketId]
    ),
    PRESUPUESTO_CONTEXTO_TICKET_MS,
    'consulta de ticket PQRS',
    []
  );

  const tareaActividades = ejecutarConPresupuesto(
    () => db.query(
      `SELECT autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_anterior, estado_nuevo, created_at
       FROM pqrs_actividades
       WHERE ticket_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 5`,
      [ticketId]
    ),
    PRESUPUESTO_CONTEXTO_TICKET_MS,
    'consulta de actividades PQRS',
    []
  );

  const tareaAdjuntos = ejecutarConPresupuesto(
    () => db.query(
      `SELECT id, nombre_archivo, categoria_detectada, resumen_ia, url_descarga, repositorio_id
       FROM documentos
       WHERE ticket_id = ?
       ORDER BY creado_en DESC, id DESC
       LIMIT 10`,
      [ticketId]
    ),
    PRESUPUESTO_CONTEXTO_TICKET_MS,
    'consulta de adjuntos del ticket',
    []
  );

  const [filasTicket, actividades, adjuntos] = await Promise.all([
    tareaTicket,
    tareaActividades,
    tareaAdjuntos,
  ]);

  const ticket = Array.isArray(filasTicket) && filasTicket.length > 0 ? filasTicket[0] : null;
  if (!ticket) {
    return { ticket: null, actividades: [], adjuntos: [], normativa: [] };
  }

  const normativa = await ejecutarConPresupuesto(
    () => buscarNormativaOficialTicket(ticket, query),
    PRESUPUESTO_CONTEXTO_TICKET_MS,
    'consulta de normativa PQRS',
    []
  );

  return {
    ticket,
    actividades: actividades || [],
    adjuntos: adjuntos || [],
    normativa: normativa || [],
  };
}

function construirFuentesCopiloto(adjuntos, normativa) {
  const fuentes = [];
  const vistos = new Set();

  for (const fragmento of normativa || []) {
    const documentoId = Number(fragmento.documento_id);
    const pagina = Number(fragmento.chunk_index || 0) + 1;
    const clave = `normativa-${documentoId}-${pagina}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    fuentes.push({
      documento_id: Number.isFinite(documentoId) ? documentoId : fragmento.documento_id,
      nombre_archivo: fragmento.nombre_archivo,
      url_descarga: Number.isFinite(documentoId) ? `/api/documents/${documentoId}/archivo` : null,
      pagina,
      score: 0.95,
      repositorio_id: fragmento.repositorio_id,
      origen: 'normativa',
    });
  }

  for (const adjunto of adjuntos || []) {
    const documentoId = Number(adjunto.id);
    const clave = `adjunto-${documentoId}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    fuentes.push({
      documento_id: Number.isFinite(documentoId) ? documentoId : adjunto.id,
      nombre_archivo: adjunto.nombre_archivo,
      url_descarga: adjunto.url_descarga || (Number.isFinite(documentoId) ? `/api/documents/${documentoId}/archivo` : null),
      pagina: 1,
      score: 0.90,
      repositorio_id: adjunto.repositorio_id,
      origen: 'adjunto',
    });
  }

  return fuentes;
}

async function manejarConsultaCopilotoTicket(req, res, { query, ticket_id, thread_id, inicioConsulta }) {
  const rolUsuario = (req.user?.rol || '').toUpperCase();
  const latenciaActual = () => Date.now() - inicioConsulta;

  if (!ROLES_OPERATIVOS_COPILOTO.includes(rolUsuario)) {
    return res.status(403).json({
      ok: false,
      mensaje: 'Acceso denegado. Solo perfiles operativos (ADMIN, SUPERVISOR, AGENTE) pueden fusionar el contexto de un ticket PQRS.',
    });
  }

  const ticketId = String(ticket_id || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(ticketId)) {
    return res.status(400).json({ ok: false, mensaje: 'Identificador de ticket PQRS inválido.' });
  }

  const contexto = await consultarContextoTicket(ticketId, query);
  if (!contexto.ticket) {
    return res.status(404).json({ ok: false, mensaje: 'Ticket PQRS no encontrado.' });
  }

  const { ticket, actividades, adjuntos, normativa } = contexto;
  const contextoUnificado = construirContextoUnificadoTicket(ticket, actividades, adjuntos, normativa);

  const systemPromptCopiloto = `
Eres el Copiloto PQRS de DocuMind, un asistente operativo para funcionarios de mesa de ayuda.
Responde SIEMPRE en español, con Markdown limpio y EXACTAMENTE estas tres secciones, en este orden y con estos títulos literales:
${SECCION_DIAGNOSTICO}
${SECCION_PASOS}
${SECCION_BORRADOR}

Reglas estrictas:
1. PROHIBIDO usar emojis, pictogramas, iconos Unicode o símbolos decorativos.
2. En "${SECCION_DIAGNOSTICO}" sintetiza el estado del ticket, la prioridad, el departamento y el riesgo real del SLA.
3. En "${SECCION_PASOS}" enumera pasos internos concretos y cita el protocolo oficial y, si existe, el adjunto del cliente.
4. En "${SECCION_BORRADOR}" redacta una respuesta formal, clara y empática lista para copiar y enviar al ciudadano.
5. Usa únicamente la información del contexto entregado; si falta un dato, indícalo sin inventarlo.
6. No agregues secciones adicionales ni texto antes de la primera sección.
`;

  const preguntaCopiloto = `Contexto unificado del ticket:\n${contextoUnificado}\n\nInstrucción del agente: ${query}`;

  const presupuestoGeneracion = Math.max(
    200,
    Math.min(PRESUPUESTO_GENERACION_COPILOTO_MS, PRESUPUESTO_GENERACION_COPILOTO_MS - latenciaActual())
  );

  let respuestaTexto = '';
  let modeloUsado = 'respaldo-copiloto-estructurado';
  let resultadoGeneracion = { texto: null, modelo: null };

  try {
    resultadoGeneracion = await generarContenidoChatGemini({
      contents: [{ role: 'user', parts: [{ text: preguntaCopiloto }] }],
      systemPrompt: systemPromptCopiloto,
      presupuestoMaximoMs: presupuestoGeneracion,
    });
  } catch (generacionErr) {
    console.warn('[Copiloto PQRS] Generación remota no disponible:', generacionErr.message);
  }

  const respuestaNormalizada = normalizarRespuestaCopiloto(resultadoGeneracion?.texto);
  if (respuestaNormalizada) {
    respuestaTexto = respuestaNormalizada;
    modeloUsado = resultadoGeneracion.modelo || 'gemini';
  } else {
    respuestaTexto = generarRespuestaCopilotoTicket({ ticket, actividades, adjuntos, normativa, query });
  }

  const fuentesCitadas = construirFuentesCopiloto(adjuntos, normativa);

  if (thread_id) {
    try {
      await db.query(
        'INSERT INTO chat_messages (thread_id, rol, contenido) VALUES (?, ?, ?)',
        [thread_id, 'user', query]
      );
      await db.query(
        'INSERT INTO chat_messages (thread_id, rol, contenido, fuentes) VALUES (?, ?, ?, ?)',
        [thread_id, 'ia', respuestaTexto, JSON.stringify(fuentesCitadas)]
      );
    } catch (histErr) {
      console.warn('[Copiloto PQRS] No se pudo persistir el hilo:', histErr.message);
    }
  }

  return res.status(200).json({
    ok: true,
    respuesta: respuestaTexto,
    fuentes_citadas: fuentesCitadas,
    thread_id: thread_id || null,
    latencia_ms: latenciaActual(),
    modelo_usado: modeloUsado,
    contexto_ticket: {
      ticket_id: ticket.ticket_id,
      estado: ticket.estado,
      prioridad: ticket.prioridad,
      departamento: ticket.departamento,
      sla_horas: ticket.sla_horas,
      es_urgente: Boolean(ticket.es_urgente),
      adjuntos: (adjuntos || []).map((adjunto) => ({
        id: adjunto.id,
        nombre_archivo: adjunto.nombre_archivo,
        categoria_detectada: adjunto.categoria_detectada,
        resumen_ia: adjunto.resumen_ia,
        url_descarga: adjunto.url_descarga,
        repositorio_id: adjunto.repositorio_id,
      })),
      normativa_aplicada: (normativa || []).map((fragmento) => ({
        documento_id: fragmento.documento_id,
        nombre_archivo: fragmento.nombre_archivo,
        pagina: Number(fragmento.chunk_index || 0) + 1,
        cita: String(fragmento.texto_chunk || '').replace(/\s+/g, ' ').slice(0, 300),
      })),
    },
    borrador_respuesta: sanearTextoCopiloto(extraerBorradorRespuesta(respuestaTexto)),
  });
}

/**
 * POST /api/chat/query
 * Motor conversacional inteligente, fluido y generador de alternativas con IA.
 */
export async function consultarRAG(req, res) {
  const inicioConsulta = Date.now();
  const latenciaActual = () => Date.now() - inicioConsulta;
  const { query, repositorio_id, thread_id, ticket_id } = req.body;

  if (!query || query.trim().length === 0) {
    return res.status(400).json({ ok: false, mensaje: 'La consulta no puede estar vacía.' });
  }

  try {
    if (ticket_id) {
      return await manejarConsultaCopilotoTicket(req, res, {
        query: query.trim(),
        ticket_id,
        thread_id,
        inicioConsulta,
      });
    }

    const rolUsuario = req.user?.rol?.toUpperCase();
    const ROLES_GLOBALES = ['ADMIN', 'AGENTE', 'SUPERVISOR'];
    let targetRepoFilter = null;
    let authorizedRepoIds = null;

    if (repositorio_id) {
      const repoIdNum = parseInt(repositorio_id, 10);
      if (isNaN(repoIdNum) || repoIdNum <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'Identificador de repositorio inválido.' });
      }

      // Validar existencia y permisos sobre el repositorio especificado
      const repos = await db.query(
        'SELECT id, departamento, usuario_id FROM repositorios WHERE id = ?',
        [repoIdNum]
      );
      if (repos.length === 0) {
        return res.status(404).json({ ok: false, mensaje: 'Repositorio no encontrado.' });
      }

      const repo = repos[0];
      if (!ROLES_GLOBALES.includes(rolUsuario)) {
        let deptoPermitido = 'Legal';
        if (rolUsuario === 'FINANCIERO') deptoPermitido = 'Financiero';
        if (rolUsuario === 'RECLUTADOR') deptoPermitido = 'Recursos Humanos';

        const tieneAcceso = (repo.departamento === deptoPermitido) || (repo.usuario_id === req.user?.id);
        if (!tieneAcceso) {
          return res.status(403).json({
            ok: false,
            mensaje: 'Acceso denegado. No tiene permisos para consultar este repositorio.',
          });
        }
      }

      targetRepoFilter = repoIdNum;
      authorizedRepoIds = [repoIdNum];
    } else {
      // Consulta sin repositorio explícito: acotar a los repositorios autorizados para el usuario
      if (!ROLES_GLOBALES.includes(rolUsuario)) {
        let deptoPermitido = 'Legal';
        if (rolUsuario === 'FINANCIERO') deptoPermitido = 'Financiero';
        if (rolUsuario === 'RECLUTADOR') deptoPermitido = 'Recursos Humanos';

        const reposPermitidos = await db.query(
          'SELECT id FROM repositorios WHERE departamento = ? OR usuario_id = ?',
          [deptoPermitido, req.user?.id]
        );
        authorizedRepoIds = reposPermitidos.map((r) => r.id);

        if (authorizedRepoIds.length === 0) {
          return res.status(200).json({
            ok: true,
            respuesta: 'No se encontraron repositorios asignados a su departamento para consultar.',
            fuentes_citadas: [],
            thread_id: thread_id || null,
            latencia_ms: latenciaActual(),
            modelo_usado: 'sin-repositorios',
          });
        }
        targetRepoFilter = authorizedRepoIds;
      }
    }

    // Recuperar los últimos 6 mensajes del hilo como contexto conversacional
    let contextoConversacional = '';
    if (thread_id) {
      try {
        const historial = await db.query(
          'SELECT rol, contenido FROM chat_messages WHERE thread_id = ? ORDER BY creado_en DESC, id DESC LIMIT 6',
          [thread_id]
        );
        if (historial && historial.length > 0) {
          contextoConversacional = historial
            .slice()
            .reverse()
            .map((m) => `${m.rol === 'user' ? 'Usuario' : 'Asistente'}: ${m.contenido}`)
            .join('\n');
        }
      } catch (histErr) {
        console.warn('[Chat RAG] No se pudo recuperar el historial conversacional:', histErr.message);
      }
    }

    // 1. Vectorizar la consulta y buscar contexto en Pinecone con filtro estricto.
    // Si falla el embedding o Pinecone, se activa un fallback léxico contra la tabla documentos.
    let relevantMatches = [];

    const buscarContextoLexico = async () => {
      try {
        const terminos = query
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 4)
          .slice(0, 6);

        const condiciones = [];
        const parametros = [];
        for (const termino of terminos) {
          condiciones.push(
            "(LOWER(COALESCE(nombre_archivo, '')) LIKE ? OR LOWER(COALESCE(resumen_ia, '')) LIKE ? OR LOWER(COALESCE(categoria_detectada, '')) LIKE ?)"
          );
          const patron = `%${termino}%`;
          parametros.push(patron, patron, patron);
        }

        let sql = `SELECT id, nombre_archivo, repositorio_id, categoria_detectada, resumen_ia
                   FROM documentos
                   WHERE estado_procesamiento = 'COMPLETADO'`;
        if (condiciones.length > 0) sql += ` AND (${condiciones.join(' OR ')})`;
        if (authorizedRepoIds && authorizedRepoIds.length > 0) {
          sql += ` AND repositorio_id IN (${authorizedRepoIds.map(() => '?').join(', ')})`;
          parametros.push(...authorizedRepoIds);
        }
        sql += ' ORDER BY id DESC LIMIT 8';

        const filas = await db.query(sql, parametros);
        return (filas || []).map((fila) => ({
          id: `lexico-${fila.id}`,
          score: 0.5,
          metadata: {
            documento_id: fila.id,
            nombre_archivo: fila.nombre_archivo,
            page_num: 1,
            text_chunk: fila.resumen_ia || `Documento clasificado como ${fila.categoria_detectada || 'general'}.`,
            repositorio_id: fila.repositorio_id,
          },
        }));
      } catch (lexErr) {
        console.warn('[Chat RAG] Fallback léxico no pudo consultar documentos:', lexErr.message);
        return [];
      }
    };

    let embeddingDisponible = false;

    try {
      const presupuestoEmbedding = Math.max(
        150,
        Math.min(900, PRESUPUESTO_TOTAL_RAG_MS - latenciaActual())
      );
      const queryVector = await generarEmbeddingGoogle(query, {
        presupuestoMaximoMs: presupuestoEmbedding,
      });
      embeddingDisponible = !esVectorDeRespaldo(queryVector);

      if (!embeddingDisponible) {
        // Sin conectividad/embeddings remotos no tiene sentido esperar a Pinecone:
        // se salta directo a la búsqueda léxica y al respaldo inmediato.
        console.warn('[Chat RAG] Embedding remoto no disponible. Se activa búsqueda léxica directa.');
        relevantMatches = await conPresupuestoRapido(
          buscarContextoLexico(),
          PRESUPUESTO_LEXICO_MS,
          'búsqueda léxica'
        ).catch(() => []);
      } else {
        const topK = 24; // Amplio para capturar fragmentos de múltiples documentos a la vez
        let matches = await conPresupuestoRapido(
          queryVectores(queryVector, targetRepoFilter, topK),
          PRESUPUESTO_VECTORIAL_MS,
          'consulta vectorial'
        );

        // Resiliencia para consultas comparativas o multi-repositorio
        if (targetRepoFilter && matches.length > 0 && matches.length < 5) {
          try {
            const broaderMatches = await conPresupuestoRapido(
              queryVectores(queryVector, authorizedRepoIds, topK),
              PRESUPUESTO_VECTORIAL_AMPLIO_MS,
              'consulta vectorial amplia'
            );
            const existingIds = new Set(matches.map((m) => m.id));
            for (const bm of broaderMatches) {
              if (!existingIds.has(bm.id)) {
                matches.push(bm);
              }
            }
          } catch (broaderErr) {
            console.warn('[Chat RAG] Búsqueda complementaria advierte:', broaderErr.message);
          }
        }

        // Defensa en profundidad: garantizar que ningún fragmento no autorizado se filtre
        if (authorizedRepoIds && authorizedRepoIds.length > 0) {
          matches = matches.filter((m) => {
            const docRepoId = Number(m.metadata?.repositorio_id);
            return authorizedRepoIds.includes(docRepoId);
          });
        }

        const MIN_SCORE = 0.48; // Umbral de similitud óptimo para comparaciones
        relevantMatches = matches.filter((m) => m.score >= MIN_SCORE);

        // Validación estricta de existencia y vigencia del documento (vectores huérfanos)
        if (relevantMatches.length > 0) {
          const docIds = [...new Set(relevantMatches.map((m) => Number(m.metadata?.documento_id)).filter((id) => !isNaN(id) && id > 0))];
          if (docIds.length > 0) {
            const placeholders = docIds.map(() => '?').join(', ');
            const docsValidos = await db.query(
              `SELECT id FROM documentos WHERE id IN (${placeholders}) AND estado_procesamiento = 'COMPLETADO'`,
              docIds
            );
            const idsValidos = new Set(docsValidos.map((d) => Number(d.id)));
            relevantMatches = relevantMatches.filter((m) => idsValidos.has(Number(m.metadata?.documento_id)));
          } else {
            relevantMatches = [];
          }
        }

        // Si Pinecone no devolvió coincidencias útiles, intentar búsqueda léxica en BD
        if (relevantMatches.length === 0) {
          relevantMatches = await conPresupuestoRapido(
            buscarContextoLexico(),
            PRESUPUESTO_LEXICO_MS,
            'búsqueda léxica'
          ).catch(() => []);
        }
      }
    } catch (vectorErr) {
      console.warn('[Chat RAG] Fallback léxico activado (embedding/Pinecone no disponible):', vectorErr.message);
      relevantMatches = await conPresupuestoRapido(
        buscarContextoLexico(),
        PRESUPUESTO_LEXICO_MS,
        'búsqueda léxica'
      ).catch(() => []);
    }

    let contextoDocumental = '';
    if (relevantMatches.length > 0) {
      contextoDocumental = relevantMatches
        .map((match) => {
          const meta = match.metadata || {};
          return `[Documento: ${meta.nombre_archivo || 'Sin nombre'} | Pág: ${meta.page_num || 1}]:\n"${meta.text_chunk || ''}"`;
        })
        .join('\n\n');
    }

    // 2. System Prompt conversacional de alto nivel (libre, natural, reflexivo)
    const systemPrompt = `
      Eres 'DocuMind', un asistente de inteligencia artificial avanzado, natural, elocuente y altamente resolutivo.
      
      INSTRUCCIONES CLAVE DE RESPUESTA:
      1. SÉ NATURAL Y HUMANO: Evita sonar como una plantilla fija o un bot programado. Responde con fluidez, estilo conversacional fresco y adaptado al tema.
      2. ANALIZA EL CONTENIDO REAL:
         - Si preguntan por una persona u hoja de vida: evalúa su perfil, fortalezas, tecnologías y adecuación para puestos.
         - Si preguntan por una factura: analiza montos, desglose de impuestos, pagos y fechas de vencimiento.
         - Si preguntan por un contrato: interpreta cláusulas, obligaciones, plazos y riesgos legales.
         - Si piden COMPARAR DOCUMENTOS, CONTRATOS O PROPUESTAS:
           * Elabora una TABLA COMPARATIVA en Markdown clara y estructurada (| Criterio | Documento A | Documento B | ... |) contrastando Partes, Objeto, Montos/Tarifas, Vigencias, SLAs, Penalizaciones y Riesgos.
           * Explica las principales diferencias y ventajas/desventajas de cada uno.
           * Concluye con una recomendación ejecutiva fundamentada sobre cuál opción es preferible o qué precauciones contractuales tomar.
         - Si preguntan por CÓMO RESOLVER UN TICKET O PQRS:
           * Diagnóstico del caso: identifica la causa y la política interna aplicable según los manuales o contratos del sistema.
           * Plan de acción paso a paso para el funcionario/agente (actividades inmediatas dentro del SLA).
           * Propuesta de respuesta formal al cliente: redacta un modelo de mensaje profesional, claro y empático que el funcionario pueda enviar.
         - Si es una pregunta general o fuera de los archivos: responde con inteligencia general, de forma útil, creativa y cordial.
      3. APORTA VALOR Y ALTERNATIVAS: No te limites a repetir fragmentos de texto. Sintetiza la información, explica qué significa y propone 2 o 3 alternativas o cursos de acción claros según el contexto.
      4. REFERENCIAS: Cuando uses información de un documento, menciona naturalmente de qué archivo proviene (ej: "Según lo estipulado en el contrato_soporte_hosting.docx...").
      5. FORMATO: Emplea Markdown limpio con negritas, tablas, viñetas y títulos claros para máxima legibilidad.
      6. IDIOMA: Responde en español impecable.

      ${contextoDocumental ? `DOCUMENTOS RELEVANTES ENCONTRADOS EN EL SISTEMA:\n${contextoDocumental}` : 'NOTA: No se hallaron documentos específicos con alta similitud para esta consulta. Inicia tu respuesta indicando de manera honesta y explícita: "No he encontrado información relevante en los documentos cargados para responder a tu consulta." Luego puedes brindar una orientación general breve si corresponde.'}
    `;

    // 3. Generación con un solo salto si hay modelo caliente; carrera paralela en frío.
    const preguntaConContexto = contextoConversacional
      ? `Contexto conversacional previo:\n${contextoConversacional}\n\nPregunta actual del usuario:\n${query}`
      : query;
    let respuestaTexto = '';
    let modeloUsado = 'respaldo-heuristico';

    // Si el embedding remoto falló y aún no hay modelo caliente, no se intenta
    // generación remota: se responde de inmediato con el respaldo contextual.
    // Además, la generación se acota al tiempo que resta del presupuesto total
    // para garantizar el primer mensaje por debajo de 1.5s.
    const presupuestoGeneracion = PRESUPUESTO_TOTAL_RAG_MS - latenciaActual();
    const puedeIntentarGeneracion =
      (embeddingDisponible || Boolean(getActiveModel())) &&
      presupuestoGeneracion >= PRESUPUESTO_MINIMO_GENERACION_MS;

    if (puedeIntentarGeneracion) {
      const resultadoGeneracion = await generarContenidoChatGemini({
        contents: [{ role: 'user', parts: [{ text: preguntaConContexto }] }],
        systemPrompt,
        presupuestoMaximoMs: presupuestoGeneracion,
      });

      if (resultadoGeneracion.texto) {
        respuestaTexto = resultadoGeneracion.texto;
        modeloUsado = resultadoGeneracion.modelo || 'gemini';
      }
    }

    // Fallback inteligente si todos los modelos remotos sufren congestión
    if (!respuestaTexto) {
      respuestaTexto = generarRespuestaAnaliticaRespaldo(
        relevantMatches.length > 0 ? relevantMatches[0] : null,
        query
      );
      modeloUsado = 'respaldo-heuristico';
    }

    // 4. Mapear fuentes citadas para el frontend mediante endpoint protegido
    const fuentesCitadas = relevantMatches.map((match) => ({
      documento_id: match.metadata.documento_id,
      nombre_archivo: match.metadata.nombre_archivo,
      url_descarga: match.metadata.documento_id ? `/api/documents/${match.metadata.documento_id}/archivo` : null,
      pagina: match.metadata.page_num || 1,
      score: match.score,
    }));

    // 5. Guardar en el historial si hay thread_id
    if (thread_id) {
      // Mensaje de usuario
      await db.query(
        'INSERT INTO chat_messages (thread_id, rol, contenido) VALUES (?, ?, ?)',
        [thread_id, 'user', query]
      );
      // Mensaje de IA
      await db.query(
        'INSERT INTO chat_messages (thread_id, rol, contenido, fuentes) VALUES (?, ?, ?, ?)',
        [thread_id, 'ia', respuestaTexto, JSON.stringify(fuentesCitadas)]
      );
    }

    return res.status(200).json({
      ok: true,
      respuesta: respuestaTexto,
      fuentes_citadas: fuentesCitadas,
      thread_id: thread_id || null,
      latencia_ms: latenciaActual(),
      modelo_usado: modeloUsado,
    });
  } catch (error) {
    console.error('Error general en Chat RAG:', error);

    const fallbackResponse = generarRespuestaAnaliticaRespaldo(null, query);

    if (thread_id) {
      try {
        await db.query('INSERT INTO chat_messages (thread_id, rol, contenido) VALUES (?, ?, ?)', [thread_id, 'user', query]);
        await db.query('INSERT INTO chat_messages (thread_id, rol, contenido, fuentes) VALUES (?, ?, ?, ?)', [thread_id, 'ia', fallbackResponse, JSON.stringify([])]);
      } catch (dbErr) {
        console.error('Error guardando fallback en bd', dbErr);
      }
    }

    return res.status(200).json({
      ok: true,
      respuesta: fallbackResponse,
      fuentes_citadas: [],
      thread_id: thread_id || null,
      latencia_ms: latenciaActual(),
      modelo_usado: 'respaldo-heuristico',
    });
  }
}

/**
 * GET /api/chat/threads
 */
export async function listarThreads(req, res) {
  try {
    const usuarioId = req.user.id;
    const { repositorio_id } = req.query;
    
    let sql = 'SELECT * FROM chat_threads WHERE usuario_id = ?';
    const params = [usuarioId];
    
    if (repositorio_id) {
      sql += ' AND repositorio_id = ?';
      params.push(repositorio_id);
    }
    
    sql += ' ORDER BY creado_en DESC';
    
    const threads = await db.query(sql, params);
    res.json({ ok: true, threads });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al listar hilos de chat.' });
  }
}

/**
 * POST /api/chat/threads
 */
export async function crearThread(req, res) {
  try {
    const usuarioId = req.user.id;
    const { titulo, repositorio_id } = req.body;
    
    if (!titulo) return res.status(400).json({ ok: false, mensaje: 'El título es requerido.' });
    
    const result = await db.query(
      'INSERT INTO chat_threads (usuario_id, repositorio_id, titulo) VALUES (?, ?, ?)',
      [usuarioId, repositorio_id || null, titulo]
    );
    
    const thread = {
      id: result.insertId,
      usuario_id: usuarioId,
      repositorio_id: repositorio_id || null,
      titulo,
      creado_en: new Date()
    };
    
    res.status(201).json({ ok: true, thread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear hilo de chat.' });
  }
}

/**
 * GET /api/chat/threads/:threadId/messages
 */
export async function listarMensajes(req, res) {
  try {
    const { threadId } = req.params;

    // Prevención de IDOR: el hilo debe existir y pertenecer al usuario (salvo ADMIN)
    const threads = await db.query(
      'SELECT id, usuario_id FROM chat_threads WHERE id = ? LIMIT 1',
      [threadId]
    );
    if (!threads || threads.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Hilo de chat no encontrado.' });
    }

    const esAdmin = (req.user?.rol || '').toUpperCase() === 'ADMIN';
    const propietario = Number(threads[0].usuario_id);
    if (!esAdmin && propietario !== Number(req.user?.id)) {
      return res.status(403).json({ ok: false, mensaje: 'No tiene permisos para acceder a este hilo.' });
    }

    const mensajes = await db.query(
      'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY creado_en ASC',
      [threadId]
    );
    
    // Parsear fuentes json
    const parsedMensajes = mensajes.map(m => {
      let fuentes = [];
      if (m.fuentes) {
        try { fuentes = JSON.parse(m.fuentes); } catch (e) {}
      }
      return { ...m, fuentes };
    });
    
    res.json({ ok: true, messages: parsedMensajes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al listar mensajes.' });
  }
}

/**
 * DELETE /api/chat/threads/:threadId
 */
export async function eliminarThread(req, res) {
  try {
    const { threadId } = req.params;
    const usuarioId = req.user.id;

    // Verificar que el thread pertenece al usuario
    const rows = await db.query(
      'SELECT id FROM chat_threads WHERE id = ? AND usuario_id = ?',
      [threadId, usuarioId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Hilo no encontrado.' });
    }

    // Los mensajes se eliminan en cascada por FK
    await db.query('DELETE FROM chat_threads WHERE id = ?', [threadId]);

    res.json({ ok: true, mensaje: 'Hilo de chat eliminado correctamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar hilo.' });
  }
}

/**
 * POST /api/chat/multimodal (alias: POST /api/chat/con-imagen)
 * Procesa una imagen o evidencia física dentro del Chatbot conversacional
 * con el módulo de Visión Multimodal (Gemini + Plan B), retornando interpretación
 * estructurada y habilitando el disparo directo a radicación PQRS.
 */
export async function consultarChatConImagen(req, res) {
  const inicioConsulta = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, mensaje: 'Debe adjuntar una imagen o formulario escaneado.' });
    }

    const { query, thread_id, repositorio_id } = req.body;
    const usuarioId = req.user?.email || req.user?.nombre || 'USUARIO_CHAT';
    const file = req.file;
    const fileBuffer = fs.readFileSync(file.path);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const resultadoVision = await procesarFormularioConVision(
      fileBuffer,
      file.mimetype,
      file.originalname,
      usuarioId
    );

    const d = resultadoVision.datos_extraidos;
    const confianzaPct = Math.round((resultadoVision.score_confianza || 0.75) * 100);
    const requiereRevision = resultadoVision.requiere_revision_humana;

    let respuestaTexto = `### Análisis Multimodal de Formulario / Novedad Física\n\n`;
    respuestaTexto += `He procesado el archivo adjunto **${file.originalname}** mediante **${resultadoVision.modelo_utilizado}**.\n\n`;
    respuestaTexto += `| Campo Extraído | Valor Detectado |\n`;
    respuestaTexto += `|---|---|\n`;
    respuestaTexto += `| **Solicitante** | ${d.nombre_solicitante || 'No detectado'} |\n`;
    respuestaTexto += `| **Correo Electrónico** | ${d.email_solicitante || 'No detectado'} |\n`;
    respuestaTexto += `| **Teléfono** | ${d.telefono_solicitante || 'No detectado'} |\n`;
    respuestaTexto += `| **Tipo de Solicitud** | **${d.tipo_solicitud}** |\n`;
    respuestaTexto += `| **Prioridad Sugerida** | **${d.prioridad_sugerida}** |\n`;
    respuestaTexto += `| **Área Responsable** | ${d.area_sugerida} |\n`;
    respuestaTexto += `| **Asunto** | ${d.asunto} |\n`;
    respuestaTexto += `| **Nivel de Confianza IA** | **${confianzaPct}%** (${resultadoVision.score_confianza.toFixed(2)}) |\n\n`;

    respuestaTexto += `**Descripción extraída:**\n> "${d.descripcion}"\n\n`;

    if (requiereRevision) {
      respuestaTexto += `**Revisión Humana Sugerida:** La certeza calculada es inferior al 85% o se detectaron observaciones en el documento:\n`;
      if (resultadoVision.advertencias && resultadoVision.advertencias.length > 0) {
        resultadoVision.advertencias.forEach(adv => {
          respuestaTexto += `- *${adv}*\n`;
        });
      } else {
        respuestaTexto += `- *Se recomienda verificar nombre y datos de contacto antes de radicar.*\n`;
      }
      respuestaTexto += `\n`;
    } else {
      respuestaTexto += `**Extracción Confiable:** La información cumple los criterios de calidad para radicación automática en PQRS.\n\n`;
    }

    if (query && query.trim().length > 0 && !query.toLowerCase().includes('analiza y digitaliza')) {
      respuestaTexto += `#### Respuesta a su consulta sobre el documento:\n`;
      respuestaTexto += `En relación con su consulta (*"${query}"*), los datos confirman un requerimiento de **${d.tipo_solicitud}** de prioridad **${d.prioridad_sugerida}** que debe ser atendido por el área de **${d.area_sugerida}**.\n`;
    }

    // Persistir en base de datos si hay thread activo
    if (thread_id) {
      try {
        const textoUser = query && query.trim().length > 0 ? query : `[Imagen adjunta: ${file.originalname}]`;
        await db.query(
          'INSERT INTO chat_messages (thread_id, rol, contenido) VALUES (?, ?, ?)',
          [thread_id, 'user', textoUser]
        );
        await db.query(
          'INSERT INTO chat_messages (thread_id, rol, contenido, fuentes) VALUES (?, ?, ?, ?)',
          [thread_id, 'ia', respuestaTexto, JSON.stringify([])]
        );
      } catch (dbErr) {
        console.warn('[Chat Multimodal] Advertencia al persistir mensaje en BD:', dbErr.message);
      }
    }

    // Conservar el archivo bajo el control de acceso de /uploads (trazabilidad y auditoría)
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
      respuesta: respuestaTexto,
      fuentes_citadas: [],
      latencia_ms: Date.now() - inicioConsulta,
      modelo_usado: resultadoVision.modelo_utilizado,
      repositorio_id: repositorio_id ? Number(repositorio_id) || null : null,
      datos_vision: {
        ...resultadoVision,
        archivo: {
          nombre: file.originalname,
          tamano_bytes: file.size,
          mimetype: file.mimetype,
          sha256,
          url_protegida: `/api/vision/archivos/${file.filename}`,
          subido_por: req.user?.id ?? req.user?.email ?? usuarioId,
          fecha_subida: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error en consultarChatConImagen:', error);
    return res.status(500).json({
      ok: false,
      mensaje: 'Error procesando la imagen en el chatbot: ' + error.message,
    });
  }
}
