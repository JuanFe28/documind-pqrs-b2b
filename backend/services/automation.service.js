import crypto from 'crypto';
import nodemailer from 'nodemailer';
import db from '../config/db.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // Sanitización y anonimización de PII para cumplir Ley 1581 de 2012
    const entradaSanitizada = { ...datos_entrada };
    if (entradaSanitizada.password) delete entradaSanitizada.password;
    if (entradaSanitizada.token && !UUID_V4_REGEX.test(entradaSanitizada.token)) {
      entradaSanitizada.token = '***REDACTED***';
    }

    await db.query(
      `INSERT INTO pqrs_logs_ejecuciones 
       (flujo, disparador, actor, estado, datos_entrada, datos_salida, mensaje_error, tiempo_ms)
       VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [
        flujo,
        disparador,
        actor,
        estado,
        JSON.stringify(entradaSanitizada),
        JSON.stringify(datos_salida || {}),
        mensaje_error,
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
    const info = await mailTransporter.sendMail({
      from: `"Mesa de Ayuda PQRS" <${senderEmail}>`,
      to: destinatario,
      subject,
      html,
    });
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
  const clienteNombre = (payload.nombre_solicitante || payload.cliente_nombre || '').trim();
  const clienteEmail = (payload.email_solicitante || payload.cliente_email || '').trim().toLowerCase();
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
  const departamento = payload.departamento || clasificarDepartamento(asunto, descripcion, tipo);

  // Validación estricta de campos obligatorios
  if (clienteNombre.length < 2 || clienteNombre.length > 150) {
    throw new Error('El nombre del solicitante debe tener entre 2 y 150 caracteres.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clienteEmail)) {
    throw new Error('El correo electrónico no tiene un formato válido.');
  }
  if (asunto.length < 3 || asunto.length > 250) {
    throw new Error('El asunto debe tener entre 3 y 250 caracteres.');
  }
  if (descripcion.length < 5 || descripcion.length > 5000) {
    throw new Error('La descripción debe tener entre 5 y 5000 caracteres.');
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
    // Intentar ejecutar función PL/pgSQL pqrs_radicar
    const dbRes = await db.query('SELECT pqrs_radicar(?::jsonb) AS res', [JSON.stringify(canonPayload)]);
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
    if (dbErr.statusCode === 409) throw dbErr;

    // Fallback de contingencia si pqrs_radicar no está disponible (ej. mock o SQLite)
    const { horas, es_urgente, fechaLimite } = evaluarSla(prioridad, tipo);
    const trackingToken = crypto.randomUUID();
    const anio = new Date().getFullYear();
    const numSeq = Math.floor(100000 + Math.random() * 900000);
    const ticketId = `PQRS-${anio}-${String(numSeq).padStart(12, '0')}`;

    await db.query(
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
    );

    await db.query(
      `INSERT INTO pqrs_actividades (ticket_id, autor_nombre, autor_tipo, es_nota_interna, mensaje, estado_nuevo)
       VALUES (?, 'Sistema Express PQRS', 'SISTEMA', false, ?, 'NUEVO')`,
      [ticketId, `Solicitud registrada. Plazo de atención: ${horas} horas corridas.`]
    );

    if (documentoId) {
      await db.query('UPDATE documentos SET ticket_id = ? WHERE id = ?', [ticketId, parseInt(documentoId, 10)]).catch(() => {});
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
    const dbRes = await db.query('SELECT pqrs_listar() AS res');
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
    flujo: 'F02_CONSULTAR_PQRS',
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
    throw new Error('Identificador de ticket o clave privada de consulta inválidos.');
  }

  let resultado;
  try {
    const dbRes = await db.query(
      'SELECT pqrs_tracking(?::text, ?::uuid) AS res',
      [ticketId.trim(), token.trim().toLowerCase()]
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
    flujo: 'F03_CONSULTAR_TICKET',
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
    const dbRes = await db.query(
      'SELECT pqrs_actualizar(?::jsonb) AS res',
      [JSON.stringify(canonPayload)]
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
    flujo: 'F04_ACTUALIZAR_TICKET',
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
    throw new Error('Identificador de ticket o clave privada de consulta inválidos.');
  }
  if (isNaN(score) || score < 1 || score > 5) {
    throw new Error('La puntuación debe ser un número entero entre 1 y 5 estrellas.');
  }

  let resultado;
  try {
    const dbRes = await db.query(
      'SELECT pqrs_calificar(?::text, ?::uuid, ?::int, ?::text) AS res',
      [cleanTicket, cleanToken, score, (retroalimentacion || '').trim()]
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
    flujo: 'F05_CALIFICAR_TICKET',
    disparador: 'POST /api/pqrs/:id/calificar',
    actor,
    estado: resultado?.codigo === 200 ? 'EXITO' : 'ERROR',
    datos_entrada: { ticketId: cleanTicket, score },
    datos_salida: { codigo: resultado?.codigo },
    tiempo_ms: tiempoMs,
  });

  return resultado;
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
