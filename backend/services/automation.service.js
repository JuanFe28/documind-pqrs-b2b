import crypto from 'crypto';
import nodemailer from 'nodemailer';
import db from '../config/db.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODIGOS_TRANSITORIOS = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'SQLITE_BUSY',
  '57P01',
  '40P01',
  '55P03',
  'P1001',
  'P2024',
]);

function esErrorTransitorio(error) {
  if (!error) return false;
  const status = error.statusCode || error.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (error.code && CODIGOS_TRANSITORIOS.has(String(error.code))) return true;
  const mensaje = String(error.message || '').toLowerCase();
  return /timeout|timed out|temporar|try again|deadlock|connection|network|fetch failed|rate limit|too many requests|service unavailable|bad gateway|gateway timeout/.test(mensaje);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta una función asíncrona con reintentos y backoff exponencial + jitter
 * ante errores transitorios. Devuelve el resultado y el número de intentos usados.
 */
export async function ejecutarConReintentos(fn, { maxAttempts = 3, baseDelayMs = 120 } = {}) {
  const limite = Math.max(1, parseInt(maxAttempts, 10) || 1);
  const base = Math.max(0, parseInt(baseDelayMs, 10) || 0);
  let intentos = 0;
  let ultimoError = null;

  while (intentos < limite) {
    intentos += 1;
    try {
      const resultado = await fn(intentos);
      return { resultado, intentos };
    } catch (error) {
      ultimoError = error;
      if (intentos >= limite || !esErrorTransitorio(error)) {
        break;
      }
      const backoff = base * 2 ** (intentos - 1);
      const jitter = Math.floor(Math.random() * (base + 1));
      await esperar(backoff + jitter);
    }
  }

  throw ultimoError;
}

/**
 * Transporter SMTP configurable con variables de entorno
 */
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    });
  }
  return transporter;
}

/**
 * Enmascara datos personales (PII) para cumplir estrictamente la Ley 1581 de 2012.
 * Oculta correos electrónicos, números telefónicos y credenciales en estructuras anidadas.
 */
export function enmascararPII(datos) {
  const CLAVE_SENSIBLE = /(password|passwd|pass|token|secret|authorization|credencial|clave)/i;
  const CLAVE_TELEFONO = /(telefono|teléfono|phone|celular|movil|móvil|whatsapp)/i;
  const CLAVE_EMAIL = /(email|correo|destinatario)/i;
  const CLAVE_IDENTIFICADOR = /(ticket|request|operation|tracking|id|radicado|uuid)/i;
  const REGEX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const REGEX_EMAIL_TEST = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const REGEX_TELEFONO_TEXTO = /(\+?\d[\d\s().-]{5,}\d)/g;

  const enmascararEmail = (valor) =>
    String(valor).replace(REGEX_EMAIL, (email) => {
      const [local, dominio] = email.split('@');
      return `${local.slice(0, 1)}***@${dominio}`;
    });

  const enmascararTelefono = (valor) => {
    const texto = String(valor);
    const totalDigitos = (texto.match(/\d/g) || []).length;
    if (totalDigitos <= 4) return texto;
    let restantes = totalDigitos - 4;
    return texto.replace(/\d/g, (digito) => {
      if (restantes > 0) {
        restantes -= 1;
        return '*';
      }
      return digito;
    });
  };

  const enmascararTelefonosEnTexto = (valor) =>
    String(valor).replace(REGEX_TELEFONO_TEXTO, (coincidencia) => {
      const digitos = (coincidencia.match(/\d/g) || []).length;
      if (digitos < 7 || digitos > 15) return coincidencia;
      const pareceTelefono = /[+\s().]/.test(coincidencia) || digitos >= 10;
      return pareceTelefono ? enmascararTelefono(coincidencia) : coincidencia;
    });

  const recorrer = (valor, clave = '') => {
    if (valor === null || valor === undefined) return valor;
    if (valor instanceof Date) return valor.toISOString();
    if (Array.isArray(valor)) return valor.map((item) => recorrer(item, clave));
    if (typeof valor === 'object') {
      if (Buffer.isBuffer(valor)) return '[BUFFER]';
      const salida = {};
      for (const [k, v] of Object.entries(valor)) {
        salida[k] = recorrer(v, k);
      }
      return salida;
    }
    if (typeof valor === 'string') {
      if (CLAVE_SENSIBLE.test(clave)) return '***REDACTED***';
      if (CLAVE_TELEFONO.test(clave)) return enmascararTelefono(valor);
      let resultado = valor;
      if (CLAVE_EMAIL.test(clave) || REGEX_EMAIL_TEST.test(resultado)) {
        resultado = enmascararEmail(resultado);
      }
      if (!CLAVE_IDENTIFICADOR.test(clave)) {
        resultado = enmascararTelefonosEnTexto(resultado);
      }
      return resultado;
    }
    if (typeof valor === 'number' && CLAVE_TELEFONO.test(clave)) {
      return enmascararTelefono(valor);
    }
    return valor;
  };

  return recorrer(datos);
}

/**
 * Registra una ejecución del motor de automatización en la tabla de auditoría.
 * Protege datos personales (PII) enmascarando correos y números sensibles si aplica.
 */
export async function registrarLogEjecucion({
  flujo,
  disparador,
  actor = 'ANONIMO',
  estado = 'EXITO',
  datos_entrada = {},
  datos_salida = {},
  mensaje_error = null,
  tiempo_ms = 0,
}) {
  try {
    const entradaSanitizada = enmascararPII(datos_entrada || {});
    const salidaSanitizada = enmascararPII(datos_salida || {});
    const actorSanitizado = actor ? enmascararPII({ actor }).actor : 'ANONIMO';
    const errorSanitizado = mensaje_error
      ? enmascararPII({ mensaje_error }).mensaje_error
      : null;

    await db.query(
      `INSERT INTO pqrs_logs_ejecuciones 
       (flujo, disparador, actor, estado, datos_entrada, datos_salida, mensaje_error, tiempo_ms)
       VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [
        flujo,
        disparador,
        actorSanitizado,
        estado,
        JSON.stringify(entradaSanitizada),
        JSON.stringify(salidaSanitizada),
        errorSanitizado,
        tiempo_ms,
      ]
    );
  } catch (err) {
    // La auditoría no debe interrumpir el flujo principal en caso de error de logging
    console.warn('[Automation Audit] Advertencia al registrar log de ejecución:', err.message);
  }
}

/**
 * Evalúa la política de SLA empresarial según prioridad y tipo de solicitud
 */
export function evaluarSla(prioridad, tipo) {
  const pNorm = (prioridad || 'Media').trim();
  const tNorm = (tipo || 'Petición').trim();

  let horas = 24;
  let es_urgente = false;

  if (pNorm === 'Crítica' || pNorm.toUpperCase() === 'CRITICA') {
    horas = 2;
    es_urgente = true;
  } else if (pNorm === 'Alta' || pNorm.toUpperCase() === 'ALTA' || tNorm === 'Reclamo' || tNorm.toUpperCase() === 'RECLAMO') {
    horas = 4;
    es_urgente = true;
  } else if (pNorm === 'Baja' || pNorm.toUpperCase() === 'BAJA') {
    horas = 48;
    es_urgente = false;
  } else {
    horas = 24;
    es_urgente = false;
  }

  const fechaLimite = new Date(Date.now() + horas * 3600 * 1000);
  return { horas, es_urgente, fechaLimite };
}

/**
 * Clasifica automáticamente el departamento responsable por heurística empresarial
 */
export function clasificarDepartamento(asunto = '', descripcion = '', tipo = '') {
  const texto = `${asunto} ${descripcion}`.toLowerCase();
  const tNorm = tipo.toLowerCase();

  if (/factur|pago|cobro|saldo|tarjeta|cobranza|dinero|cuenta|banco/.test(texto)) {
    return 'Facturación y Cobranzas';
  }
  if (tNorm.includes('reclamo') || tNorm.includes('queja') || /calidad|defecto|garant|daño|aver|roto|mal estado/.test(texto)) {
    return 'Control de Calidad y Garantías';
  }
  return 'Soporte Técnico y Sistemas';
}

/**
 * Envía notificación por correo electrónico de manera desacoplada
 */
export async function enviarCorreoNotificacion({
  tipo,
  destinatario,
  nombre,
  ticket_id,
  tracking_token,
  asunto,
  horas_sla,
  prioridad,
  estado_alerta,
  sla_fecha_limite,
  periodo,
  resumen,
  por_departamento,
  nivel,
  motivo,
}) {
  const mailTransporter = getTransporter();
  const senderEmail = process.env.SMTP_FROM || 'notificaciones@documind-pqrs.com';

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const trackingUrl = `${baseUrl}/#token=${tracking_token}&id=${ticket_id}`;

  let subject = '';
  let html = '';

  if (tipo === 'CONFIRMACION_CLIENTE') {
    subject = `Radicado exitoso: ${ticket_id} - ${asunto}`;
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">Constancia de Radicación PQRS</h2>
        <p>Estimado(a) <strong>${nombre}</strong>,</p>
        <p>Su solicitud ha sido radicada formalmente en nuestro sistema con los siguientes datos:</p>
        <ul>
          <li><strong>Número de Radicado:</strong> ${ticket_id}</li>
          <li><strong>Asunto:</strong> ${asunto}</li>
          <li><strong>Prioridad:</strong> ${prioridad}</li>
          <li><strong>Plazo Máximo de Respuesta (SLA):</strong> ${horas_sla} horas</li>
        </ul>
        <p>Puede hacer seguimiento en tiempo real de su caso utilizando su clave privada en el siguiente enlace:</p>
        <p><a href="${trackingUrl}" style="background-color: #2563eb; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; display: inline-block;">Consultar Estado de mi Solicitud</a></p>
        <p style="font-size: 0.85rem; color: #64748b;">Clave privada (Token de seguimiento): <code>${tracking_token}</code></p>
      </div>
    `;
  } else if (tipo === 'ALERTA_SUPERVISOR') {
    subject = `🚨 ALERTA ESCALAMIENTO URGENTE: ${ticket_id} (${prioridad})`;
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fca5a5; border-radius: 8px; background-color: #fff1f2;">
        <h2 style="color: #991b1b;">Notificación de Escalamiento Inmediato</h2>
        <p>Se ha registrado un caso crítico/urgente que requiere asignación prioritaria:</p>
        <ul>
          <li><strong>Radicado:</strong> ${ticket_id}</li>
          <li><strong>Solicitante:</strong> ${nombre} (${destinatario})</li>
          <li><strong>Asunto:</strong> ${asunto}</li>
          <li><strong>SLA Límite:</strong> ${horas_sla} horas</li>
        </ul>
        <p>Por favor ingrese al panel operativo para gestionar el caso de inmediato.</p>
      </div>
    `;
  } else if (tipo === 'ALERTA_SLA') {
    const esVencida = String(estado_alerta || '').toUpperCase().includes('VENCIDA');
    subject = `${esVencida ? '🚨 SLA VENCIDA' : '⏰ SLA POR VENCER'}: ${ticket_id} (${prioridad})`;
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid ${esVencida ? '#fca5a5' : '#fcd34d'}; border-radius: 8px; background-color: ${esVencida ? '#fff1f2' : '#fffbeb'};">
        <h2 style="color: ${esVencida ? '#991b1b' : '#92400e'};">Alerta de Acuerdo de Nivel de Servicio (SLA)</h2>
        <p>El siguiente radicado ${esVencida ? 'ha superado su tiempo límite de atención' : 'está próximo a vencer su SLA (menos de 4 horas)'}:</p>
        <ul>
          <li><strong>Radicado:</strong> ${ticket_id}</li>
          <li><strong>Asunto:</strong> ${asunto}</li>
          <li><strong>Prioridad:</strong> ${prioridad}</li>
          <li><strong>SLA definido:</strong> ${horas_sla} horas</li>
          <li><strong>Fecha límite:</strong> ${sla_fecha_limite || 'No registrada'}</li>
          <li><strong>Estado de la alerta:</strong> ${estado_alerta || 'SLA_POR_VENCER'}</li>
        </ul>
        <p>Se requiere gestión inmediata por parte del equipo responsable.</p>
      </div>
    `;
  } else if (tipo === 'REPORTE_SEMANAL') {
    const r = resumen || {};
    const filasDepartamento = Array.isArray(por_departamento) && por_departamento.length > 0
      ? por_departamento
          .map(
            (d) =>
              `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${d.departamento || 'Sin área'}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${d.total ?? 0}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${d.resueltos ?? 0}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="3" style="padding:6px 8px;">Sin datos en el periodo</td></tr>';

    subject = `📊 Reporte Semanal Consolidado PQRS (${periodo?.desde || ''} - ${periodo?.hasta || ''})`;
    html = `
      <div style="font-family: sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; border: 1px solid #bfdbfe; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">Reporte Semanal Consolidado de PQRS</h2>
        <p><strong>Periodo analizado:</strong> ${periodo?.desde || ''} a ${periodo?.hasta || ''}</p>
        <ul>
          <li><strong>Total radicados:</strong> ${r.total ?? 0}</li>
          <li><strong>Resueltos / cerrados:</strong> ${r.resueltos ?? 0}</li>
          <li><strong>Pendientes:</strong> ${r.pendientes ?? 0}</li>
          <li><strong>Vencidos de SLA:</strong> ${r.vencidos ?? 0}</li>
          <li><strong>Satisfacción CSAT promedio:</strong> ${r.satisfaccion_promedio ?? 'Sin datos'}</li>
        </ul>
        <h3 style="color: #1e3a8a;">Distribución por departamento</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #93c5fd;">Departamento</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #93c5fd;">Total</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #93c5fd;">Resueltos</th></tr></thead>
          <tbody>${filasDepartamento}</tbody>
        </table>
      </div>
    `;
  } else if (tipo === 'ENCUESTA_CSAT') {
    subject = `⭐ Encuesta de Satisfacción CSAT: ${ticket_id}`;
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #bbf7d0; border-radius: 8px; background-color: #f0fdf4;">
        <h2 style="color: #166534;">Su solicitud ha sido cerrada</h2>
        <p>Estimado(a) <strong>${nombre}</strong>,</p>
        <p>El radicado <strong>${ticket_id}</strong> (${asunto}) fue cerrado por nuestro equipo de atención.</p>
        <p>Su opinión es muy importante. Por favor califique la atención recibida de 1 a 5 estrellas:</p>
        <p><a href="${trackingUrl}" style="background-color: #16a34a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; display: inline-block;">Responder Encuesta CSAT</a></p>
        <p style="font-size: 0.85rem; color: #64748b;">Clave privada (Token de seguimiento): <code>${tracking_token}</code></p>
      </div>
    `;
  } else if (tipo === 'ESCALAMIENTO_N2') {
    subject = `🚨 ESCALAMIENTO NIVEL 2: ${ticket_id} (${prioridad})`;
    html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fca5a5; border-radius: 8px; background-color: #fff1f2;">
        <h2 style="color: #991b1b;">Escalamiento a Nivel 2</h2>
        <p>El siguiente caso de prioridad <strong>${prioridad}</strong> requiere intervención del Nivel 2:</p>
        <ul>
          <li><strong>Radicado:</strong> ${ticket_id}</li>
          <li><strong>Asunto:</strong> ${asunto}</li>
          <li><strong>Nivel:</strong> ${nivel || 2}</li>
          <li><strong>Motivo:</strong> ${motivo || 'Prioridad Crítica/Alta'}</li>
          <li><strong>SLA definido:</strong> ${horas_sla} horas</li>
        </ul>
      </div>
    `;
  }

  if (!destinatario) {
    return {
      enviado: false,
      estado: 'SIN_CONFIRMAR',
      detalle: 'Destinatario no disponible para la notificación',
    };
  }

  if (!mailTransporter) {
    // Si no hay SMTP configurado, registrar simulación exitosa sin abortar
    return {
      enviado: false,
      estado: 'SIN_CONFIRMAR',
      detalle: 'Servicio SMTP no configurado en variables de entorno (simulación)',
    };
  }

  try {
    const { resultado: info } = await ejecutarConReintentos(
      () =>
        mailTransporter.sendMail({
          from: `"Mesa de Ayuda PQRS" <${senderEmail}>`,
          to: destinatario,
          subject,
          html,
        }),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    return { enviado: true, estado: 'ENVIADA', detalle: `Mensaje aceptado: ${info.messageId}` };
  } catch (error) {
    console.warn(`[Automation SMTP] Error al enviar correo (${tipo}):`, error.message);
    return { enviado: false, estado: 'ERROR', detalle: error.message };
  }
}

/**
 * F01: Servicio Nativo de Radicación de PQRS (Ruta A)
 */
export async function radicarSolicitudNativa(payload, actor = 'PORTAL_PUBLICO') {
  const inicioMs = Date.now();
  const requestId = payload.request_id || crypto.randomUUID();

  // Normalización de nombres de campos
  const clienteNombre = (payload.nombre_solicitante || payload.cliente_nombre || payload.nombre || '').trim();
  const clienteEmail = (payload.email_solicitante || payload.cliente_email || payload.email || '').trim().toLowerCase();
  const clienteTelefono = (payload.telefono || payload.cliente_telefono || '').trim();
  const asunto = (payload.asunto || '').trim();
  const descripcion = (payload.descripcion || '').trim();
  const documentoId = payload.documento_id ? String(payload.documento_id).trim() : null;

  // Normalizar tipo de solicitud
  const tipoInput = (payload.tipo_solicitud || payload.tipo || 'Petición').trim();
  const mapTipo = {
    'peticion': 'Petición',
    'petición': 'Petición',
    'queja': 'Queja',
    'reclamo': 'Reclamo',
    'soporte tecnico': 'Soporte Técnico',
    'soporte técnico': 'Soporte Técnico',
    'soporte_tecnico': 'Soporte Técnico',
    'sugerencia': 'Sugerencia',
  };
  const tipo = mapTipo[tipoInput.toLowerCase()] || 'Petición';

  // Normalizar prioridad
  const prioridadInput = (payload.prioridad || 'Media').trim();
  const mapPrioridad = {
    'baja': 'Baja',
    'media': 'Media',
    'alta': 'Alta',
    'critica': 'Crítica',
    'crítica': 'Crítica',
  };
  const prioridad = mapPrioridad[prioridadInput.toLowerCase()] || 'Media';

  // Departamento
  const departamento =
    payload.departamento ||
    payload.area ||
    payload.area_sugerida ||
    clasificarDepartamento(asunto, descripcion, tipo);

  const registrarFalloYLanzar = async (mensaje, statusCode = 400) => {
    const error = new Error(mensaje);
    error.statusCode = statusCode;
    await registrarLogEjecucion({
      flujo: 'F01_RADICAR_PQRS',
      disparador: 'HTTP_POST',
      actor,
      estado: 'ERROR',
      datos_entrada: payload,
      mensaje_error: error.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    throw error;
  };

  // Validación estricta de campos obligatorios
  if (clienteNombre.length < 2 || clienteNombre.length > 150) {
    await registrarFalloYLanzar('El nombre del solicitante debe tener entre 2 y 150 caracteres.', 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clienteEmail)) {
    await registrarFalloYLanzar('El correo electrónico no tiene un formato válido.', 400);
  }
  if (asunto.length < 3 || asunto.length > 250) {
    await registrarFalloYLanzar('El asunto debe tener entre 3 y 250 caracteres.', 400);
  }
  if (descripcion.length < 5 || descripcion.length > 5000) {
    await registrarFalloYLanzar('La descripción debe tener entre 5 y 5000 caracteres.', 400);
  }

  // Objeto canónico para la función almacenada PostgreSQL
  const canonPayload = {
    request_id: requestId,
    cliente_nombre: clienteNombre,
    cliente_email: clienteEmail,
    cliente_telefono: clienteTelefono,
    tipo,
    prioridad,
    departamento,
    asunto,
    descripcion,
    documento_id: documentoId,
  };

  let resultadoDb;
  let solicitud;
  let esReintentoIdempotente = false;

  try {
    // Intentar ejecutar función PL/pgSQL pqrs_radicar con reintentos ante fallos transitorios
    const { resultado: dbRes } = await ejecutarConReintentos(
      () => db.query('SELECT pqrs_radicar(?::jsonb) AS res', [JSON.stringify(canonPayload)]),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    resultadoDb = dbRes[0]?.res;

    if (!resultadoDb) {
      throw new Error('Respuesta nula de pqrs_radicar');
    }

    if (!resultadoDb.creada && !resultadoDb.coincide) {
      const err = new Error('Conflicto: Este request_id ya fue utilizado con un contenido diferente.');
      err.statusCode = 409;
      throw err;
    }

    esReintentoIdempotente = !resultadoDb.creada && resultadoDb.coincide;
    solicitud = resultadoDb.solicitud;
  } catch (dbErr) {
    if (dbErr.statusCode === 409) {
      await registrarLogEjecucion({
        flujo: 'F01_RADICAR_PQRS',
        disparador: 'HTTP_POST',
        actor,
        estado: 'ERROR',
        datos_entrada: payload,
        mensaje_error: dbErr.message,
        tiempo_ms: Date.now() - inicioMs,
      });
      throw dbErr;
    }

    // Fallback de contingencia si pqrs_radicar no está disponible (ej. mock o SQLite)
    const { horas, es_urgente, fechaLimite } = evaluarSla(prioridad, tipo);
    const trackingToken = crypto.randomUUID();
    const anio = new Date().getFullYear();
    const numSeq = Math.floor(100000 + Math.random() * 900000);
    const ticketId = `PQRS-${anio}-${String(numSeq).padStart(12, '0')}`;

    try {
      await ejecutarConReintentos(
        () =>
          db.query(
            `INSERT INTO pqrs_solicitudes 
             (ticket_id, request_id, tracking_token, cliente_nombre, nombre_solicitante, cliente_email, email_solicitante, 
              cliente_telefono, telefono, tipo, tipo_solicitud, prioridad, departamento, asunto, descripcion, 
              estado, es_urgente, sla_horas, sla_fecha_limite, confirmacion_estado, alerta_estado)
             VALUES (?, ?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NUEVO', ?, ?, ?, 'PENDIENTE', ?)`,
            [
              ticketId,
              requestId,
              trackingToken,
              clienteNombre,
              clienteNombre,
              clienteEmail,
              clienteEmail,
              clienteTelefono,
              clienteTelefono,
              tipo,
              tipo,
              prioridad,
              departamento,
              asunto,
              descripcion,
              es_urgente,
              horas,
              fechaLimite,
              es_urgente ? 'PENDIENTE' : 'NO_APLICA',
            ]
          ),
        { maxAttempts: 3, baseDelayMs: 120 }
      );

      await ejecutarConReintentos(
        () =>
          db.query(
            `INSERT INTO pqrs_actividades (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_nuevo)
             VALUES (?, 'Sistema Express PQRS', 'SISTEMA', false, ?, 'NUEVO')`,
            [ticketId, `Solicitud registrada. Plazo de atención: ${horas} horas corridas.`]
          ),
        { maxAttempts: 3, baseDelayMs: 120 }
      );

      if (documentoId) {
        await db.query('UPDATE documentos SET ticket_id = ? WHERE id = ?', [ticketId, parseInt(documentoId, 10)]).catch(() => {});
      }
    } catch (insertErr) {
      console.warn('[Automation DB Fallback] Base de datos no disponible, procesando en memoria:', insertErr.message);
      await registrarLogEjecucion({
        flujo: 'F01_RADICAR_PQRS',
        disparador: 'POST /api/pqrs/radicar',
        actor,
        estado: 'ERROR',
        datos_entrada: payload,
        mensaje_error: `Error 500 en persistencia de contingencia: ${insertErr.message}`,
        tiempo_ms: Date.now() - inicioMs,
      });
    }

    solicitud = {
      ticket_id: ticketId,
      tracking_token: trackingToken,
      request_id: requestId,
      cliente_nombre: clienteNombre,
      cliente_email: clienteEmail,
      tipo,
      prioridad,
      departamento,
      asunto,
      sla_horas: horas,
      sla_fecha_limite: fechaLimite,
      estado: 'NUEVO',
      es_urgente,
    };
  }

  // Envío asíncrono de correos (no bloquea la respuesta al cliente)
  if (!esReintentoIdempotente) {
    setImmediate(async () => {
      try {
        const resCliente = await enviarCorreoNotificacion({
          tipo: 'CONFIRMACION_CLIENTE',
          destinatario: solicitud.cliente_email || clienteEmail,
          nombre: solicitud.cliente_nombre || clienteNombre,
          ticket_id: solicitud.ticket_id,
          tracking_token: solicitud.tracking_token,
          asunto: solicitud.asunto || asunto,
          horas_sla: solicitud.sla_horas,
          prioridad: solicitud.prioridad || prioridad,
        });

        await db.query(
          'SELECT pqrs_registrar_correo(?::uuid, $1, $2, $3)',
          [solicitud.request_id || requestId, 'confirmacion', resCliente.estado, resCliente.detalle]
        ).catch(() => {});

        if (solicitud.es_urgente) {
          const supervisorEmail = process.env.SUPERVISOR_ALERT_EMAIL || 'supervisor@documind-pqrs.com';
          const resAlerta = await enviarCorreoNotificacion({
            tipo: 'ALERTA_SUPERVISOR',
            destinatario: supervisorEmail,
            nombre: solicitud.cliente_nombre || clienteNombre,
            ticket_id: solicitud.ticket_id,
            tracking_token: solicitud.tracking_token,
            asunto: solicitud.asunto || asunto,
            horas_sla: solicitud.sla_horas,
            prioridad: solicitud.prioridad || prioridad,
          });

          await db.query(
            'SELECT pqrs_registrar_correo(?::uuid, $1, $2, $3)',
            [solicitud.request_id || requestId, 'alerta', resAlerta.estado, resAlerta.detalle]
          ).catch(() => {});
        }
      } catch (mailErr) {
        console.warn('[Automation Mail] Error en segundo plano:', mailErr.message);
      }
    });
  }

  const tiempoMs = Date.now() - inicioMs;
  await registrarLogEjecucion({
    flujo: 'F01_RADICAR_PQRS',
    disparador: 'POST /api/pqrs/radicar',
    actor,
    estado: esReintentoIdempotente ? 'REINTENTO' : 'EXITO',
    datos_entrada: canonPayload,
    datos_salida: { ticket_id: solicitud.ticket_id, sla_horas: solicitud.sla_horas },
    tiempo_ms: tiempoMs,
  });

  return {
    codigo_http: esReintentoIdempotente ? 200 : 201,
    status: 'success',
    mensaje: esReintentoIdempotente ? 'Solicitud recuperada por reintento idempotente' : 'Solicitud radicada con éxito',
    ticket_id: solicitud.ticket_id,
    tracking_token: solicitud.tracking_token,
    sla_horas: solicitud.sla_horas,
    sla_fecha_limite: solicitud.sla_fecha_limite,
    estado: solicitud.estado,
    es_urgente: solicitud.es_urgente,
    departamento: solicitud.departamento,
  };
}

/**
 * F02: Consulta Operativa de Agentes y KPIs (Ruta A)
 */
export async function consultarWorkspaceNativo(actor = 'AGENTE') {
  const inicioMs = Date.now();
  let resultado;

  try {
    const { resultado: dbRes } = await ejecutarConReintentos(
      () => db.query('SELECT pqrs_listar() AS res'),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    resultado = dbRes[0]?.res;
  } catch (err) {
    // Fallback de consulta directa
    const [totales] = await db.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE es_urgente) AS urgentes,
        COUNT(*) FILTER (WHERE NOT es_urgente) AS estandar,
        COUNT(*) FILTER (WHERE estado IN ('RESUELTO', 'CERRADO')) AS resueltos,
        COUNT(*) FILTER (WHERE estado IN ('ASIGNADO', 'EN_GESTION')) AS en_gestion,
        COUNT(*) FILTER (WHERE estado NOT IN ('RESUELTO', 'CERRADO')) AS activos,
        round(AVG(satisfaccion_score)::numeric, 1) AS satisfaccion_promedio
      FROM pqrs_solicitudes
    `);

    const tickets = await db.query(
      `SELECT s.*, s.cliente_email AS email FROM pqrs_solicitudes s ORDER BY s.id DESC LIMIT 100`
    );

    const agentes = await db.query(
      `SELECT id, nombre, email, departamento, rol FROM usuarios_agentes WHERE activo ORDER BY nombre`
    );

    resultado = {
      status: 'success',
      ...totales,
      tickets: tickets || [],
      agentes: agentes || [],
    };
  }

  const tiempoMs = Date.now() - inicioMs;
  await registrarLogEjecucion({
    flujo: 'F06_CONSULTAR_PQRS',
    disparador: 'GET /api/pqrs/consultar',
    actor,
    estado: 'EXITO',
    datos_salida: { total: resultado?.total || 0 },
    tiempo_ms: tiempoMs,
  });

  return resultado;
}

/**
 * F03: Seguimiento Privado de Ticket (Ruta A)
 */
export async function trackingTicketNativo(ticketId, token, actor = 'CIUDADANO') {
  const inicioMs = Date.now();
  if (!ticketId || !token || !UUID_V4_REGEX.test(token.trim())) {
    await registrarLogEjecucion({
      flujo: 'F07_CONSULTAR_TICKET',
      disparador: 'GET /api/pqrs/:id/tracking',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticketId },
      mensaje_error: 'Identificador de ticket o clave privada de consulta inválidos.',
      tiempo_ms: Date.now() - inicioMs,
    });
    throw new Error('Identificador de ticket o clave privada de consulta inválidos.');
  }

  let resultado;
  try {
    const { resultado: dbRes } = await ejecutarConReintentos(
      () =>
        db.query(
          'SELECT pqrs_tracking(?::text, ?::uuid) AS res',
          [ticketId.trim(), token.trim().toLowerCase()]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    resultado = dbRes[0]?.res;
  } catch (err) {
    const tickets = await db.query(
      `SELECT ticket_id, cliente_nombre, tipo, prioridad, departamento, asunto, descripcion, 
              estado, sla_horas, sla_fecha_limite, fecha_radicacion, fecha_resolucion, satisfaccion_score
       FROM pqrs_solicitudes 
       WHERE ticket_id = ? AND tracking_token = ?::uuid LIMIT 1`,
      [ticketId.trim(), token.trim().toLowerCase()]
    );

    if (!tickets || tickets.length === 0) {
      resultado = { status: 'error', codigo: 404, mensaje: 'Radicado o clave de consulta incorrectos' };
    } else {
      const timeline = await db.query(
        `SELECT autor_nombre AS autor, autor_tipo AS tipo, mensaje, created_at AS fecha 
         FROM pqrs_actividades 
         WHERE ticket_id = ? AND NOT es_nota_interna ORDER BY id ASC`,
        [ticketId.trim()]
      );
      resultado = {
        status: 'success',
        codigo: 200,
        ticket: { ...tickets[0], timeline: timeline || [] },
      };
    }
  }

  const tiempoMs = Date.now() - inicioMs;
  await registrarLogEjecucion({
    flujo: 'F07_CONSULTAR_TICKET',
    disparador: 'GET /api/pqrs/:id/tracking',
    actor,
    estado: resultado?.codigo === 200 ? 'EXITO' : 'ERROR',
    datos_entrada: { ticketId },
    datos_salida: { codigo: resultado?.codigo },
    tiempo_ms: tiempoMs,
  });

  return resultado;
}

/**
 * F04: Actualización Atómica con Concurrencia Optimista (Ruta A)
 */
export async function actualizarTicketNativo(payload, actor = 'AGENTE') {
  const inicioMs = Date.now();
  const operationId = payload.operation_id || crypto.randomUUID();

  const canonPayload = {
    ticket_id: (payload.ticket_id || '').trim(),
    nuevo_estado: (payload.nuevo_estado || '').trim(),
    mensaje_resolucion: (payload.mensaje_resolucion || payload.nota || '').trim(),
    version: parseInt(payload.version || 1, 10),
    agente_id: payload.agente_id,
    es_nota_interna: Boolean(payload.es_nota_interna),
    operation_id: operationId,
  };

  let resultado;
  try {
    const { resultado: dbRes } = await ejecutarConReintentos(
      () =>
        db.query(
          'SELECT pqrs_actualizar(?::jsonb) AS res',
          [JSON.stringify(canonPayload)]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    resultado = dbRes[0]?.res;
  } catch (err) {
    // Si la función falla, realizar actualización directa con validación optimista
    const tickets = await db.query('SELECT * FROM pqrs_solicitudes WHERE ticket_id = ? FOR UPDATE', [canonPayload.ticket_id]);
    if (!tickets || tickets.length === 0) {
      resultado = { status: 'error', codigo: 404, mensaje: 'Radicado no encontrado' };
    } else {
      const s = tickets[0];
      if (s.version !== canonPayload.version) {
        resultado = { status: 'error', codigo: 409, mensaje: 'El ticket cambió. Actualiza el listado antes de editarlo.' };
      } else {
        const fechaResolucion = ['RESUELTO', 'CERRADO'].includes(canonPayload.nuevo_estado) ? new Date() : null;
        await db.query(
          `UPDATE pqrs_solicitudes 
           SET estado = ?, version = version + 1, fecha_resolucion = COALESCE(?, fecha_resolucion), updated_at = NOW() 
           WHERE id = ?`,
          [canonPayload.nuevo_estado, fechaResolucion, s.id]
        );
        await db.query(
          `INSERT INTO pqrs_actividades (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_anterior, estado_nuevo, operation_id)
           VALUES (?, ?, 'AGENTE', ?, ?, ?, ?, ?::uuid)`,
          [s.ticket_id, actor, canonPayload.es_nota_interna, canonPayload.mensaje_resolucion, s.estado, canonPayload.nuevo_estado, operationId]
        );
        resultado = {
          status: 'success',
          codigo: 200,
          ticket_id: s.ticket_id,
          estado: canonPayload.nuevo_estado,
          version: s.version + 1,
          mensaje: 'Ticket actualizado correctamente',
        };
      }
    }
  }

  const tiempoMs = Date.now() - inicioMs;
  await registrarLogEjecucion({
    flujo: 'F08_ACTUALIZAR_TICKET',
    disparador: 'PUT /api/pqrs/:id/actualizar',
    actor,
    estado: resultado?.codigo === 200 ? 'EXITO' : 'ERROR',
    datos_entrada: canonPayload,
    datos_salida: { codigo: resultado?.codigo, nuevo_estado: canonPayload.nuevo_estado },
    tiempo_ms: tiempoMs,
  });

  return resultado;
}

/**
 * F05: Calificación de Satisfacción CSAT (Ruta A)
 */
export async function calificarTicketNativo(ticketId, token, puntuacion, retroalimentacion = '', actor = 'CIUDADANO') {
  const inicioMs = Date.now();
  const cleanTicket = (ticketId || '').trim();
  const cleanToken = (token || '').trim().toLowerCase();
  const score = parseInt(puntuacion, 10);

  if (!cleanTicket || !cleanToken || !UUID_V4_REGEX.test(cleanToken)) {
    await registrarLogEjecucion({
      flujo: 'F09_CALIFICAR_TICKET',
      disparador: 'POST /api/pqrs/:id/calificar',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticketId: cleanTicket },
      mensaje_error: 'Identificador de ticket o clave privada de consulta inválidos.',
      tiempo_ms: Date.now() - inicioMs,
    });
    throw new Error('Identificador de ticket o clave privada de consulta inválidos.');
  }
  if (isNaN(score) || score < 1 || score > 5) {
    await registrarLogEjecucion({
      flujo: 'F09_CALIFICAR_TICKET',
      disparador: 'POST /api/pqrs/:id/calificar',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticketId: cleanTicket, score },
      mensaje_error: 'La puntuación debe ser un número entero entre 1 y 5 estrellas.',
      tiempo_ms: Date.now() - inicioMs,
    });
    throw new Error('La puntuación debe ser un número entero entre 1 y 5 estrellas.');
  }

  let resultado;
  try {
    const { resultado: dbRes } = await ejecutarConReintentos(
      () =>
        db.query(
          'SELECT pqrs_calificar(?::text, ?::uuid, ?::int, ?::text) AS res',
          [cleanTicket, cleanToken, score, (retroalimentacion || '').trim()]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );
    resultado = dbRes[0]?.res;
  } catch (err) {
    const tickets = await db.query(
      'SELECT id, estado FROM pqrs_solicitudes WHERE ticket_id = ? AND tracking_token = ?::uuid LIMIT 1',
      [cleanTicket, cleanToken]
    );
    if (!tickets || tickets.length === 0) {
      resultado = { status: 'error', codigo: 404, mensaje: 'Radicado o clave de consulta incorrectos' };
    } else if (!['RESUELTO', 'CERRADO'].includes(tickets[0].estado)) {
      resultado = { status: 'error', codigo: 400, mensaje: 'Solo puede calificar solicitudes resueltas o cerradas' };
    } else {
      await db.query('UPDATE pqrs_solicitudes SET satisfaccion_score = ? WHERE id = ?', [score, tickets[0].id]);
      await db.query(
        `INSERT INTO pqrs_actividades (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje)
         VALUES (?, 'Cliente Titular', 'CLIENTE', false, ?)`,
        [cleanTicket, `Calificación CSAT: ${score}/5 estrellas. Comentario: ${retroalimentacion || 'Sin comentarios'}`]
      );
      resultado = { status: 'success', codigo: 200, mensaje: '¡Gracias por calificar la atención!', score, ticket_id: cleanTicket };
    }
  }

  const tiempoMs = Date.now() - inicioMs;
  await registrarLogEjecucion({
    flujo: 'F09_CALIFICAR_TICKET',
    disparador: 'POST /api/pqrs/:id/calificar',
    actor,
    estado: resultado?.codigo === 200 ? 'EXITO' : 'ERROR',
    datos_entrada: { ticketId: cleanTicket, score },
    datos_salida: { codigo: resultado?.codigo },
    tiempo_ms: tiempoMs,
  });

  return resultado;
}

function obtenerEmailSupervisor() {
  return process.env.SUPERVISOR_ALERT_EMAIL || process.env.REPORTE_SEMANAL_EMAIL || 'supervisor@documind-pqrs.com';
}

function obtenerEmailNivel2() {
  return process.env.N2_ESCALATION_EMAIL || process.env.SUPERVISOR_ALERT_EMAIL || 'nivel2@documind-pqrs.com';
}

/**
 * F02: Alertas automáticas de SLA próximas a vencer (< 4 horas) y vencidas.
 */
export async function procesarAlertasSla({ umbralHoras = 4, actor = 'MOTOR_AUTOMATIZACION' } = {}) {
  const inicioMs = Date.now();
  const umbral = Number(umbralHoras) > 0 ? Number(umbralHoras) : 4;
  const fechaCorte = new Date(Date.now() + umbral * 3600 * 1000);

  try {
    const { resultado: tickets } = await ejecutarConReintentos(
      () =>
        db.query(
          `SELECT ticket_id, cliente_nombre, nombre_solicitante, cliente_email, email_solicitante,
                  prioridad, asunto, estado, sla_horas, sla_fecha_limite, departamento
           FROM pqrs_solicitudes
           WHERE estado NOT IN ('RESUELTO', 'CERRADO')
             AND sla_fecha_limite IS NOT NULL
             AND sla_fecha_limite <= ?
             AND (sla_alerta_enviada = false OR sla_alerta_enviada IS NULL)
           ORDER BY sla_fecha_limite ASC`,
          [fechaCorte]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    const ahora = Date.now();
    const alertas = [];

    for (const ticket of tickets || []) {
      const limiteMs = new Date(ticket.sla_fecha_limite).getTime();
      const tipoAlerta = limiteMs < ahora ? 'SLA_VENCIDA' : 'SLA_POR_VENCER';
      const destinatario =
        ticket.email_solicitante ||
        ticket.cliente_email ||
        obtenerEmailSupervisor();

      let envio = { estado: 'SIN_CONFIRMAR', detalle: 'No procesado' };
      try {
        const { resultado } = await ejecutarConReintentos(
          async () => {
            const respuesta = await enviarCorreoNotificacion({
              tipo: 'ALERTA_SLA',
              destinatario,
              nombre: ticket.nombre_solicitante || ticket.cliente_nombre,
              ticket_id: ticket.ticket_id,
              asunto: ticket.asunto,
              horas_sla: ticket.sla_horas,
              prioridad: ticket.prioridad,
              estado_alerta: tipoAlerta,
              sla_fecha_limite: ticket.sla_fecha_limite,
            });
            if (respuesta.estado === 'ERROR' && esErrorTransitorio(new Error(respuesta.detalle))) {
              throw new Error(respuesta.detalle);
            }
            return respuesta;
          },
          { maxAttempts: 3, baseDelayMs: 120 }
        );
        envio = resultado;
      } catch (mailErr) {
        envio = { estado: 'ERROR', detalle: mailErr.message };
      }

      const fueEnviada = envio.estado === 'ENVIADA';
      await ejecutarConReintentos(
        () =>
          db.query(
            `UPDATE pqrs_solicitudes
             SET sla_alerta_enviada = ?, alerta_estado = ?, alerta_error = ?
             WHERE ticket_id = ?`,
            [fueEnviada, envio.estado, String(envio.detalle || '').slice(0, 1000), ticket.ticket_id]
          ),
        { maxAttempts: 3, baseDelayMs: 120 }
      ).catch(() => {});

      alertas.push({
        ticket_id: ticket.ticket_id,
        tipo: tipoAlerta,
        prioridad: ticket.prioridad,
        sla_fecha_limite: ticket.sla_fecha_limite,
        estado_envio: envio.estado,
      });
    }

    await registrarLogEjecucion({
      flujo: 'F02_ALERTAS_SLA',
      disparador: 'JOB / GET /api/automation/alertas-sla',
      actor,
      estado: 'EXITO',
      datos_entrada: { umbral_horas: umbral },
      datos_salida: { total_alertas: alertas.length, alertas },
      tiempo_ms: Date.now() - inicioMs,
    });

    return {
      status: 'success',
      codigo: 200,
      mensaje: `Se procesaron ${alertas.length} alertas de SLA`,
      total: alertas.length,
      alertas,
    };
  } catch (error) {
    await registrarLogEjecucion({
      flujo: 'F02_ALERTAS_SLA',
      disparador: 'JOB / GET /api/automation/alertas-sla',
      actor,
      estado: 'ERROR',
      datos_entrada: { umbral_horas: umbral },
      mensaje_error: error.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    const err = new Error(`Error al procesar alertas de SLA: ${error.message}`);
    err.statusCode = 500;
    throw err;
  }
}

/**
 * F03: Reporte semanal consolidado de PQRS, SLAs y satisfacción CSAT.
 */
export async function generarReporteSemanal({
  desde,
  hasta,
  destinatario,
  actor = 'MOTOR_AUTOMATIZACION',
} = {}) {
  const inicioMs = Date.now();
  const fechaHasta = hasta ? new Date(hasta) : new Date();
  const fechaDesde = desde ? new Date(desde) : new Date(fechaHasta.getTime() - 7 * 24 * 3600 * 1000);

  if (Number.isNaN(fechaDesde.getTime()) || Number.isNaN(fechaHasta.getTime())) {
    const err = new Error('Las fechas del reporte semanal no son válidas.');
    err.statusCode = 400;
    await registrarLogEjecucion({
      flujo: 'F03_REPORTE_SEMANAL',
      disparador: 'JOB / GET /api/automation/reporte-semanal',
      actor,
      estado: 'ERROR',
      datos_entrada: { desde, hasta },
      mensaje_error: err.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    throw err;
  }

  try {
    const { resultado: filasResumen } = await ejecutarConReintentos(
      () =>
        db.query(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN estado IN ('RESUELTO', 'CERRADO') THEN 1 ELSE 0 END) AS resueltos,
             SUM(CASE WHEN estado NOT IN ('RESUELTO', 'CERRADO') THEN 1 ELSE 0 END) AS pendientes,
             SUM(CASE WHEN sla_fecha_limite < ? AND estado NOT IN ('RESUELTO', 'CERRADO') THEN 1 ELSE 0 END) AS vencidos,
             AVG(satisfaccion_score) AS satisfaccion_promedio
           FROM pqrs_solicitudes
           WHERE fecha_radicacion >= ? AND fecha_radicacion <= ?`,
          [fechaHasta, fechaDesde, fechaHasta]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    const resumenBase = (filasResumen && filasResumen[0]) || {};
    const resumen = {
      total: parseInt(resumenBase.total || 0, 10),
      resueltos: parseInt(resumenBase.resueltos || 0, 10),
      pendientes: parseInt(resumenBase.pendientes || 0, 10),
      vencidos: parseInt(resumenBase.vencidos || 0, 10),
      satisfaccion_promedio:
        resumenBase.satisfaccion_promedio === null || resumenBase.satisfaccion_promedio === undefined
          ? null
          : Number(Number(resumenBase.satisfaccion_promedio).toFixed(1)),
    };

    const { resultado: porDepartamento } = await ejecutarConReintentos(
      () =>
        db.query(
          `SELECT departamento,
                  COUNT(*) AS total,
                  SUM(CASE WHEN estado IN ('RESUELTO', 'CERRADO') THEN 1 ELSE 0 END) AS resueltos
           FROM pqrs_solicitudes
           WHERE fecha_radicacion >= ? AND fecha_radicacion <= ?
           GROUP BY departamento
           ORDER BY total DESC`,
          [fechaDesde, fechaHasta]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    const periodo = {
      desde: fechaDesde.toISOString(),
      hasta: fechaHasta.toISOString(),
    };

    const emailDestino = destinatario || process.env.REPORTE_SEMANAL_EMAIL || obtenerEmailSupervisor();
    let envio = { estado: 'SIN_CONFIRMAR', detalle: 'No procesado' };
    try {
      const { resultado } = await ejecutarConReintentos(
        () =>
          enviarCorreoNotificacion({
            tipo: 'REPORTE_SEMANAL',
            destinatario: emailDestino,
            periodo,
            resumen,
            por_departamento: porDepartamento || [],
          }),
        { maxAttempts: 3, baseDelayMs: 120 }
      );
      envio = resultado;
    } catch (mailErr) {
      envio = { estado: 'ERROR', detalle: mailErr.message };
    }

    await registrarLogEjecucion({
      flujo: 'F03_REPORTE_SEMANAL',
      disparador: 'JOB / GET /api/automation/reporte-semanal',
      actor,
      estado: 'EXITO',
      datos_entrada: { periodo },
      datos_salida: { ...resumen, estado_envio: envio.estado },
      tiempo_ms: Date.now() - inicioMs,
    });

    return {
      status: 'success',
      codigo: 200,
      mensaje: 'Reporte semanal consolidado generado',
      periodo,
      resumen,
      por_departamento: porDepartamento || [],
      envio,
    };
  } catch (error) {
    await registrarLogEjecucion({
      flujo: 'F03_REPORTE_SEMANAL',
      disparador: 'JOB / GET /api/automation/reporte-semanal',
      actor,
      estado: 'ERROR',
      datos_entrada: { desde, hasta },
      mensaje_error: error.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    const err = new Error(`Error al generar reporte semanal: ${error.message}`);
    err.statusCode = 500;
    throw err;
  }
}

/**
 * F04: Cierre formal del ticket con envío automático de encuesta CSAT.
 */
export async function cerrarTicketConEncuestaCSAT(payload = {}, actor = 'AGENTE') {
  const inicioMs = Date.now();
  const ticketId = String(payload.ticket_id || payload.ticketId || '').trim();
  const mensajeResolucion = String(
    payload.mensaje_resolucion || payload.mensaje || 'Solicitud resuelta y cerrada por el equipo de atención.'
  ).trim();

  const registrarFallo = async (mensaje, statusCode) => {
    await registrarLogEjecucion({
      flujo: 'F04_CIERRE_CSAT',
      disparador: 'POST /api/automation/tickets/:ticketId/cerrar-csat',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticket_id: ticketId, mensaje_resolucion: mensajeResolucion },
      mensaje_error: mensaje,
      tiempo_ms: Date.now() - inicioMs,
    });
    return { status: 'error', codigo: statusCode, mensaje };
  };

  if (!ticketId) {
    return registrarFallo('El identificador del radicado es obligatorio.', 400);
  }

  try {
    const { resultado: tickets } = await ejecutarConReintentos(
      () =>
        db.query(
          `SELECT ticket_id, tracking_token, cliente_nombre, nombre_solicitante,
                  cliente_email, email_solicitante, estado, asunto, prioridad, sla_horas
           FROM pqrs_solicitudes
           WHERE ticket_id = ?
           LIMIT 1`,
          [ticketId]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    if (!tickets || tickets.length === 0) {
      return registrarFallo('Radicado no encontrado.', 404);
    }

    const ticket = tickets[0];
    if (ticket.estado === 'CERRADO') {
      return registrarFallo('El radicado ya se encuentra cerrado.', 409);
    }

    await ejecutarConReintentos(
      () =>
        db.query(
          `UPDATE pqrs_solicitudes
           SET estado = 'CERRADO', fecha_resolucion = COALESCE(fecha_resolucion, NOW()), version = version + 1
           WHERE ticket_id = ?`,
          [ticketId]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    await ejecutarConReintentos(
      () =>
        db.query(
          `INSERT INTO pqrs_actividades
             (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_anterior, estado_nuevo)
           VALUES (?, ?, 'AGENTE', false, ?, ?, 'CERRADO')`,
          [ticketId, actor, mensajeResolucion, ticket.estado]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    const destinatario = ticket.email_solicitante || ticket.cliente_email;
    let encuesta = { estado: 'SIN_CONFIRMAR', detalle: 'Solicitante sin correo electrónico' };
    if (destinatario) {
      try {
        const { resultado } = await ejecutarConReintentos(
          () =>
            enviarCorreoNotificacion({
              tipo: 'ENCUESTA_CSAT',
              destinatario,
              nombre: ticket.nombre_solicitante || ticket.cliente_nombre,
              ticket_id: ticketId,
              tracking_token: ticket.tracking_token,
              asunto: ticket.asunto,
              prioridad: ticket.prioridad,
              horas_sla: ticket.sla_horas,
            }),
          { maxAttempts: 3, baseDelayMs: 120 }
        );
        encuesta = resultado;
      } catch (mailErr) {
        encuesta = { estado: 'ERROR', detalle: mailErr.message };
      }
    }

    await registrarLogEjecucion({
      flujo: 'F04_CIERRE_CSAT',
      disparador: 'POST /api/automation/tickets/:ticketId/cerrar-csat',
      actor,
      estado: 'EXITO',
      datos_entrada: { ticket_id: ticketId },
      datos_salida: { codigo: 200, encuesta: encuesta.estado },
      tiempo_ms: Date.now() - inicioMs,
    });

    return {
      status: 'success',
      codigo: 200,
      mensaje: 'Radicado cerrado y encuesta CSAT enviada',
      ticket_id: ticketId,
      estado: 'CERRADO',
      encuesta,
    };
  } catch (error) {
    await registrarLogEjecucion({
      flujo: 'F04_CIERRE_CSAT',
      disparador: 'POST /api/automation/tickets/:ticketId/cerrar-csat',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticket_id: ticketId },
      mensaje_error: error.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    const err = new Error(`Error al cerrar el radicado con encuesta CSAT: ${error.message}`);
    err.statusCode = 500;
    throw err;
  }
}

/**
 * F05: Escalamiento automático a Nivel 2 para prioridad Crítica o Alta.
 */
export async function escalarTicketNivel2(payload = {}, actor = 'SISTEMA') {
  const inicioMs = Date.now();
  const ticketId = String(payload.ticket_id || payload.ticketId || '').trim();
  const motivo = String(payload.motivo || 'Prioridad Crítica/Alta').trim();

  const registrarFallo = async (mensaje, statusCode) => {
    await registrarLogEjecucion({
      flujo: 'F05_ESCALAMIENTO_N2',
      disparador: 'POST /api/automation/tickets/:ticketId/escalar-n2',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticket_id: ticketId },
      mensaje_error: mensaje,
      tiempo_ms: Date.now() - inicioMs,
    });
    return { status: 'error', codigo: statusCode, mensaje };
  };

  if (!ticketId) {
    return registrarFallo('El identificador del radicado es obligatorio.', 400);
  }

  try {
    const { resultado: tickets } = await ejecutarConReintentos(
      () =>
        db.query(
          `SELECT ticket_id, prioridad, estado, asunto, cliente_nombre, nombre_solicitante,
                  cliente_email, email_solicitante, tracking_token, sla_horas, sla_fecha_limite
           FROM pqrs_solicitudes
           WHERE ticket_id = ?
           LIMIT 1`,
          [ticketId]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    if (!tickets || tickets.length === 0) {
      return registrarFallo('Radicado no encontrado.', 404);
    }

    const ticket = tickets[0];
    const prioridadNormalizada = String(ticket.prioridad || '').trim().toLowerCase();
    const esCriticaOAlta = ['crítica', 'critica', 'alta'].includes(prioridadNormalizada);

    if (!esCriticaOAlta) {
      return registrarFallo('El escalamiento N2 solo aplica a prioridad Crítica o Alta.', 400);
    }

    await ejecutarConReintentos(
      () =>
        db.query(
          `INSERT INTO pqrs_actividades
             (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_anterior, estado_nuevo)
           VALUES (?, ?, 'SISTEMA', true, ?, ?, ?)`,
          [
            ticketId,
            actor,
            `Escalamiento automático a Nivel 2 por prioridad ${ticket.prioridad}. Motivo: ${motivo}`,
            ticket.estado,
            ticket.estado,
          ]
        ),
      { maxAttempts: 3, baseDelayMs: 120 }
    );

    const destinatario = obtenerEmailNivel2();
    let envio = { estado: 'SIN_CONFIRMAR', detalle: 'No procesado' };
    try {
      const { resultado } = await ejecutarConReintentos(
        () =>
          enviarCorreoNotificacion({
            tipo: 'ESCALAMIENTO_N2',
            destinatario,
            nombre: ticket.nombre_solicitante || ticket.cliente_nombre,
            ticket_id: ticketId,
            tracking_token: ticket.tracking_token,
            asunto: ticket.asunto,
            horas_sla: ticket.sla_horas,
            prioridad: ticket.prioridad,
            nivel: 2,
            motivo,
          }),
        { maxAttempts: 3, baseDelayMs: 120 }
      );
      envio = resultado;
    } catch (mailErr) {
      envio = { estado: 'ERROR', detalle: mailErr.message };
    }

    await registrarLogEjecucion({
      flujo: 'F05_ESCALAMIENTO_N2',
      disparador: 'POST /api/automation/tickets/:ticketId/escalar-n2',
      actor,
      estado: 'EXITO',
      datos_entrada: { ticket_id: ticketId, prioridad: ticket.prioridad },
      datos_salida: { codigo: 200, nivel: 2, envio: envio.estado },
      tiempo_ms: Date.now() - inicioMs,
    });

    return {
      status: 'success',
      codigo: 200,
      mensaje: 'Radicado escalado a Nivel 2',
      ticket_id: ticketId,
      nivel: 2,
      prioridad: ticket.prioridad,
      envio,
    };
  } catch (error) {
    await registrarLogEjecucion({
      flujo: 'F05_ESCALAMIENTO_N2',
      disparador: 'POST /api/automation/tickets/:ticketId/escalar-n2',
      actor,
      estado: 'ERROR',
      datos_entrada: { ticket_id: ticketId },
      mensaje_error: error.message,
      tiempo_ms: Date.now() - inicioMs,
    });
    const err = new Error(`Error al escalar el radicado a Nivel 2: ${error.message}`);
    err.statusCode = 500;
    throw err;
  }
}

/**
 * Consulta de Logs de Auditoría para Administradores
 */
export async function consultarLogsEjecuciones({ flujo, estado, limit = 50, offset = 0 }) {
  const conditions = [];
  const params = [];

  if (flujo) {
    conditions.push('flujo = ?');
    params.push(flujo);
  }
  if (estado) {
    conditions.push('estado = ?');
    params.push(estado);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT id, flujo, disparador, actor, estado, datos_entrada, datos_salida, mensaje_error, tiempo_ms, created_at
     FROM pqrs_logs_ejecuciones
     ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit, 10), parseInt(offset, 10)]
  );

  const [countRow] = await db.query(`SELECT COUNT(*) AS total FROM pqrs_logs_ejecuciones ${where}`, params);
  return {
    total: parseInt(countRow?.total || 0, 10),
    logs: rows || [],
  };
}

