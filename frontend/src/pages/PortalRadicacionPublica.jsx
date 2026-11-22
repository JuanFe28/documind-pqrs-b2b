import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileSearch,
  FileText,
  Key,
  Loader2,
  Lock,
  MessageSquare,
  Receipt,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  WifiOff,
} from 'lucide-react';
import axios from 'axios';
import { automationAPI } from '../services/api';
import { formatEstadoLabel, formatFechaHora, normalizarClave } from '../utils/pqrs';
import { PORTAL_TAB_EVENT } from '../components/TourGuiado';

const PLANTILLAS_RAPIDAS = [
  {
    id: 'conectividad',
    etiqueta: 'Falla de conectividad',
    detalle: 'Intermitencia o caída del servicio',
    icono: WifiOff,
    tipo_solicitud: 'Soporte Técnico',
    prioridad: 'Alta',
    departamento: 'Soporte Técnico y Sistemas',
    asunto: 'Falla de conectividad en el servicio',
    descripcion:
      'Desde el día de hoy el servicio presenta intermitencias y cortes de conexión. Solicito revisión técnica y diagnóstico del origen de la falla.',
  },
  {
    id: 'facturacion',
    etiqueta: 'Facturación duplicada',
    detalle: 'Cobro repetido en la factura',
    icono: Receipt,
    tipo_solicitud: 'Reclamo',
    prioridad: 'Alta',
    departamento: 'Facturación y Cobranzas',
    asunto: 'Cobro duplicado en la factura del periodo',
    descripcion:
      'Identifiqué un cobro duplicado correspondiente al mismo periodo en mi factura. Adjunto el soporte y solicito la verificación y el ajuste correspondiente.',
  },
  {
    id: 'garantia',
    etiqueta: 'Garantía de producto',
    detalle: 'Cambio o revisión de equipo',
    icono: ShieldCheck,
    tipo_solicitud: 'Reclamo',
    prioridad: 'Media',
    departamento: 'Control de Calidad y Garantías',
    asunto: 'Solicitud de garantía por producto defectuoso',
    descripcion:
      'El producto presenta una falla de funcionamiento dentro del periodo de garantía. Solicito la revisión técnica y, de ser procedente, el cambio del equipo.',
  },
  {
    id: 'informacion',
    etiqueta: 'Solicitud de información',
    detalle: 'Consulta sobre un trámite',
    icono: FileSearch,
    tipo_solicitud: 'Petición',
    prioridad: 'Baja',
    departamento: 'Atención al Cliente General',
    asunto: 'Solicitud de información sobre el trámite',
    descripcion:
      'Requiero información detallada sobre los requisitos, plazos y canales disponibles para completar el trámite asociado a mi solicitud.',
  },
  {
    id: 'queja',
    etiqueta: 'Queja por atención',
    detalle: 'Inconformidad con la atención',
    icono: MessageSquare,
    tipo_solicitud: 'Queja',
    prioridad: 'Media',
    departamento: 'Atención al Cliente General',
    asunto: 'Inconformidad con la atención recibida',
    descripcion:
      'Presento una queja por la atención recibida durante mi última solicitud. Solicito revisión del caso y una respuesta oficial sobre las acciones adoptadas.',
  },
];

const FORMULARIO_INICIAL = {
  nombre: '',
  email: '',
  telefono: '',
  tipo_solicitud: 'Petición',
  prioridad: 'Media',
  departamento: 'Atención al Cliente General',
  asunto: '',
  descripcion: '',
};

function obtenerParametroInicial(nombre) {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    return hashParams.get(nombre) || searchParams.get(nombre) || null;
  } catch {
    return null;
  }
}

export default function PortalRadicacionPublica() {
  const [tab, setTab] = useState('radicar');

  const [formData, setFormData] = useState({ ...FORMULARIO_INICIAL });
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [radicadoExitoso, setRadicadoExitoso] = useState(null);
  const [tokenCopiado, setTokenCopiado] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [autorizacionDatos, setAutorizacionDatos] = useState(false);
  const [documentoIdUrl, setDocumentoIdUrl] = useState(() => obtenerParametroInicial('documento_id'));

  const [ticketQuery, setTicketQuery] = useState('');
  const [tokenQuery, setTokenQuery] = useState('');
  const [buscandoTicket, setBuscandoTicket] = useState(false);
  const [ticketEncontrado, setTicketEncontrado] = useState(null);
  const [trackingError, setTrackingError] = useState('');
  const [descargandoDocId, setDescargandoDocId] = useState(null);

  const [csatRating, setCsatRating] = useState(0);
  const [csatComentario, setCsatComentario] = useState('');
  const [enviandoCsat, setEnviandoCsat] = useState(false);
  const [csatMensaje, setCsatMensaje] = useState('');
  const [csatError, setCsatError] = useState('');

  const handleChange = (event) => {
    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const aplicarPlantilla = (plantilla) => {
    setFormData((prev) => ({
      ...prev,
      tipo_solicitud: plantilla.tipo_solicitud,
      prioridad: plantilla.prioridad,
      departamento: plantilla.departamento,
      asunto: plantilla.asunto,
      descripcion: plantilla.descripcion,
    }));
    setErrorMsg('');
  };

  const handleRadicar = async (event) => {
    event.preventDefault();
    if (!autorizacionDatos) {
      setErrorMsg(
        'Debe autorizar el tratamiento de sus datos personales (Ley 1581 de 2012) para radicar la solicitud.'
      );
      return;
    }

    setEnviando(true);
    setErrorMsg('');

    try {
      let documentoId = null;
      let resumenIa = null;

      if (archivo) {
        const fileForm = new FormData();
        fileForm.append('file', archivo);
        fileForm.append('repositorio_id', 1);

        try {
          const uploadRes = await axios.post('/api/documents/upload', fileForm, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          documentoId = uploadRes.data?.documento?.id || null;
          resumenIa = uploadRes.data?.documento?.resumen_ia || null;
        } catch (uploadErr) {
          console.warn('Carga directa de archivo opcional:', uploadErr.message);
        }
      }

      const webhookPayload = {
        request_id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `req-${Date.now()}`,
        nombre_solicitante: formData.nombre,
        nombre: formData.nombre,
        email_solicitante: formData.email,
        email: formData.email,
        telefono: formData.telefono,
        tipo_solicitud: formData.tipo_solicitud,
        prioridad: formData.prioridad,
        departamento: formData.departamento,
        asunto: formData.asunto,
        descripcion:
          formData.descripcion +
          (resumenIa ? `\n\n[Resumen Documento Adjunto por IA]: ${resumenIa}` : ''),
      };

      const documentoFinal = documentoId || documentoIdUrl;
      if (documentoFinal) {
        webhookPayload.documento_id = documentoFinal;
      }

      let res;
      try {
        res = await axios.post('/api/pqrs/radicar', webhookPayload);
      } catch {
        try {
          res = await axios.post('/webhook/radicar-pqrs', webhookPayload);
        } catch {
          res = await axios.post('http://localhost:5678/webhook/radicar-pqrs', webhookPayload);
        }
      }

      const dataRespuesta = res.data?.respuesta || res.data || {};
      const ticketId =
        dataRespuesta.ticket_id || res.data?.ticket?.ticket_id || res.data?.ticket_id;
      const trackingToken =
        dataRespuesta.tracking_token ||
        res.data?.ticket?.tracking_token ||
        res.data?.tracking_token ||
        null;
      const slaHoras =
        dataRespuesta.sla_horas ||
        res.data?.ticket?.sla_horas ||
        (formData.prioridad === 'Crítica' ? 2 : 24);

      setRadicadoExitoso({
        ticket_id: ticketId || `PQRS-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        tracking_token: trackingToken,
        fecha_radicacion: new Date().toLocaleString('es-CO'),
        sla_horas: slaHoras,
      });
    } catch (err) {
      console.error('Error al radicar:', err);
      setErrorMsg(
        err.response?.data?.mensaje ||
          'Error al conectar con el motor de radicación. Verifique que los servicios estén activos.'
      );
    } finally {
      setEnviando(false);
    }
  };

  async function consultarTracking(ticket, token) {
    const cleanTicket = (ticket || '').trim();
    const cleanToken = (token || '').trim();
    if (!cleanTicket) return;

    setBuscandoTicket(true);
    setTrackingError('');
    setTicketEncontrado(null);
    setCsatRating(0);
    setCsatComentario('');
    setCsatMensaje('');
    setCsatError('');

    try {
      if (cleanToken) {
        const res = await axios.post(
          `/api/pqrs/${encodeURIComponent(cleanTicket)}/tracking`,
          { tracking_token: cleanToken }
        );
        const data = { ...res.data?.data, es_privado: true };
        setTicketEncontrado(data);
        const score = Number(data?.ticket?.satisfaccion_score);
        if (Number.isFinite(score) && score > 0) {
          setCsatRating(score);
        }
      } else {
        const res = await axios.get(`/api/pqrs/${encodeURIComponent(cleanTicket)}`);
        setTicketEncontrado({ ...res.data?.data, es_privado: false });
      }
    } catch (err) {
      const status = err.response?.status;
      const mensaje = err.response?.data?.mensaje;
      if (status === 429) {
        setTrackingError(
          mensaje || 'Demasiados intentos fallidos. Intente nuevamente en 15 minutos.'
        );
      } else if (cleanToken) {
        setTrackingError(
          mensaje || 'Radicado o clave privada de consulta incorrectos. Verifique los datos.'
        );
      } else {
        setTrackingError(
          mensaje || 'No se encontró ningún radicado con el identificador ingresado.'
        );
      }
    } finally {
      setBuscandoTicket(false);
    }
  }

  function aplicarHashTracking() {
    try {
      const rawHash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
      if (!rawHash) return;

      const params = new URLSearchParams(rawHash);
      const token = params.get('token');
      const idFromHash = params.get('id');
      const documentoFromHash = params.get('documento_id');

      const searchParams = new URLSearchParams(window.location.search);
      const ticketId = idFromHash || searchParams.get('id');

      if (documentoFromHash) {
        setDocumentoIdUrl(documentoFromHash);
      }

      if (window.history?.replaceState) {
        const cleanUrl = `${window.location.pathname}${
          ticketId ? `?id=${encodeURIComponent(ticketId)}` : ''
        }`;
        window.history.replaceState(null, '', cleanUrl);
      }

      if (!token) return;

      setTab('tracking');
      setTokenQuery(token);
      if (ticketId) {
        setTicketQuery(ticketId);
        consultarTracking(ticketId, token);
      }
    } catch {
      // Un fragmento mal formado no debe interrumpir la consulta manual.
    }
  }

  useEffect(() => {
    aplicarHashTracking();
    const onHashChange = () => aplicarHashTracking();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onTabSolicitada = (evento) => {
      if (evento.detail === 'radicar' || evento.detail === 'tracking') {
        setTab(evento.detail);
      }
    };
    window.addEventListener(PORTAL_TAB_EVENT, onTabSolicitada);
    return () => window.removeEventListener(PORTAL_TAB_EVENT, onTabSolicitada);
  }, []);

  const handleConsultar = (event) => {
    event.preventDefault();
    consultarTracking(ticketQuery, tokenQuery);
  };

  const copiarClave = async () => {
    if (!radicadoExitoso?.tracking_token) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(radicadoExitoso.tracking_token);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = radicadoExitoso.tracking_token;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setTokenCopiado(true);
      setTimeout(() => setTokenCopiado(false), 3000);
    } catch (err) {
      console.warn('Error al copiar al portapapeles:', err);
    }
  };

  const irASeguimientoPrivado = () => {
    if (!radicadoExitoso) return;
    const { ticket_id, tracking_token } = radicadoExitoso;
    setTicketQuery(ticket_id);
    if (tracking_token) {
      setTokenQuery(tracking_token);
    }
    setTab('tracking');
    consultarTracking(ticket_id, tracking_token || '');
  };

  const handleDescargarDocCiudadano = async (documento) => {
    if (!tokenQuery || !ticketEncontrado?.ticket?.ticket_id) return;
    let objectUrl = null;
    try {
      setDescargandoDocId(documento.id);
      const ticketId = ticketEncontrado.ticket.ticket_id;
      const res = await fetch(
        `/api/pqrs/${encodeURIComponent(ticketId)}/documentos/${documento.id}`,
        {
          method: 'GET',
          headers: { 'x-tracking-token': tokenQuery.trim() },
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.mensaje || 'Error al descargar el archivo.');
      }

      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = objectUrl;
      enlace.download = documento.nombre_archivo || 'documento_radicado';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
    } catch (err) {
      setTrackingError(err.message || 'Error al descargar el archivo.');
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setDescargandoDocId(null);
    }
  };

  const estadoActual = normalizarClave(ticketEncontrado?.ticket?.estado);
  const puedeCalificar =
    Boolean(ticketEncontrado?.es_privado && tokenQuery) &&
    ['RESUELTO', 'CERRADO'].includes(estadoActual);

  const handleCalificar = async (event) => {
    event.preventDefault();
    if (!puedeCalificar || !csatRating || enviandoCsat) return;

    setEnviandoCsat(true);
    setCsatError('');
    setCsatMensaje('');

    try {
      const ticketId = ticketEncontrado.ticket.ticket_id;
      const res = await automationAPI.calificar(ticketId, {
        token: tokenQuery.trim(),
        puntuacion: csatRating,
        retroalimentacion: csatComentario.trim(),
      });
      setCsatMensaje(
        res.data?.mensaje || 'Gracias por calificar la atención. Tu opinión fue registrada.'
      );
      setTicketEncontrado((prev) =>
        prev
          ? {
              ...prev,
              ticket: { ...prev.ticket, satisfaccion_score: csatRating },
            }
          : prev
      );
    } catch (err) {
      setCsatError(
        err.response?.data?.mensaje || 'No fue posible registrar la calificación. Intente de nuevo.'
      );
    } finally {
      setEnviandoCsat(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col bg-[var(--color-bg-main)] text-[var(--color-text)] selection:bg-[var(--color-accent)] selection:text-white">
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 flex justify-center">
          <div
            role="tablist"
            aria-label="Secciones del portal"
            className="inline-flex w-full max-w-md items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'radicar'}
              onClick={() => setTab('radicar')}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors active:scale-[0.98] ${
                tab === 'radicar'
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)]'
              }`}
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              Radicar solicitud
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tracking'}
              onClick={() => setTab('tracking')}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors active:scale-[0.98] ${
                tab === 'tracking'
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)]'
              }`}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              Consultar estado
            </button>
          </div>
        </div>

        {tab === 'radicar' ? (
          radicadoExitoso ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-[var(--color-surface)] p-6 sm:p-8 animate-fade-in">
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600" strokeWidth={1.75} />
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600">
                  Radicado exitoso
                </p>
                <h2 className="mt-1 font-mono text-2xl font-bold tracking-tight text-[var(--color-text)]">
                  {radicadoExitoso.ticket_id}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Guarde este número de radicado y su clave privada. Recibirá notificaciones
                  oficiales en su correo electrónico.
                </p>
              </div>

              {radicadoExitoso.tracking_token ? (
                <div className="mt-6 border-t border-[var(--color-border)] pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
                      <Key className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Clave privada de consulta
                    </span>
                    <button
                      type="button"
                      onClick={copiarClave}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-bg-main)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-accent)] transition-colors hover:bg-[var(--color-surface)] active:scale-[0.98]"
                    >
                      {tokenCopiado ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
                          <span className="text-emerald-600">Copiada</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Copiar clave</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-3 select-all break-all rounded-lg bg-[var(--color-bg-main)] px-3 py-2.5 font-mono text-xs tracking-wide text-[var(--color-text)]">
                    {radicadoExitoso.tracking_token}
                  </div>

                  <div className="mt-4 flex items-start gap-2 border-l-2 border-amber-500 pl-3 text-[11px] leading-relaxed text-amber-700">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.75} />
                    <span>
                      <strong className="font-semibold">Advertencia de seguridad:</strong> conserve
                      esta clave en un lugar seguro. Es su credencial para desbloquear la
                      descripción completa y las respuestas oficiales. DocuMind no permite
                      recuperar claves privadas extraviadas.
                    </span>
                  </div>
                </div>
              ) : null}

              <dl className="mt-6 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] text-xs">
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-[var(--color-text-subtle)]">Tiempo estimado SLA</dt>
                  <dd className="font-mono font-bold text-[var(--color-accent)] tabular-nums">
                    {radicadoExitoso.sla_horas} horas
                  </dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-[var(--color-text-subtle)]">Fecha de radicación</dt>
                  <dd className="font-mono text-[var(--color-text-muted)] tabular-nums">
                    {radicadoExitoso.fecha_radicacion}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setRadicadoExitoso(null);
                    setFormData({ ...FORMULARIO_INICIAL });
                    setArchivo(null);
                    setAutorizacionDatos(false);
                  }}
                  className="rounded-xl px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] active:scale-[0.98]"
                >
                  Radicar otra solicitud
                </button>
                <button
                  type="button"
                  onClick={irASeguimientoPrivado}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
                >
                  <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
                  Ver seguimiento privado
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="mx-auto max-w-xl space-y-3 text-center">
                <span className="inline-flex rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
                  Plataforma empresarial
                </span>
                <h2 className="text-balance text-2xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-3xl">
                  Radicación de peticiones, quejas y reclamos
                </h2>
                <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                  Diligencie el formulario. Nuestro motor de IA analizará y clasificará su
                  solicitud con asignación automática a los especialistas del área.
                </p>
              </div>

              <form
                onSubmit={handleRadicar}
                data-tour="entrada-radicacion"
                className="space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl backdrop-blur-xl sm:p-8"
              >
                {errorMsg ? (
                  <div className="flex items-start gap-2.5 rounded-lg bg-rose-50 px-3.5 py-3 text-xs text-rose-600">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span>{errorMsg}</span>
                  </div>
                ) : null}

                <div className="border-b border-[var(--color-border)] pb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                      Plantillas rápidas
                    </p>
                    <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-subtle)]">
                      <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                      Completa el caso en un clic
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PLANTILLAS_RAPIDAS.map((plantilla) => {
                      const Icono = plantilla.icono;
                      return (
                        <button
                          key={plantilla.id}
                          type="button"
                          onClick={() => aplicarPlantilla(plantilla)}
                          title={plantilla.detalle}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-bg-main)] px-2.5 py-2 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] active:scale-[0.98]"
                        >
                          <Icono className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                          {plantilla.etiqueta}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="radicar-nombre" className="text-xs font-semibold text-[var(--color-text-muted)]">
                      Nombre completo *
                    </label>
                    <input
                      id="radicar-nombre"
                      type="text"
                      name="nombre"
                      required
                      placeholder="Ej. Juan Pérez"
                      value={formData.nombre}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="radicar-email" className="text-xs font-semibold text-[var(--color-text-muted)]">
                      Correo electrónico *
                    </label>
                    <input
                      id="radicar-email"
                      type="email"
                      name="email"
                      required
                      placeholder="juan@empresa.com"
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="radicar-telefono" className="text-xs font-semibold text-[var(--color-text-muted)]">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      id="radicar-telefono"
                      type="tel"
                      name="telefono"
                      placeholder="+57 300 123 4567"
                      value={formData.telefono}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="radicar-tipo" className="text-xs font-semibold text-[var(--color-text-muted)]">
                      Tipo de requerimiento *
                    </label>
                    <select
                      id="radicar-tipo"
                      name="tipo_solicitud"
                      value={formData.tipo_solicitud}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]"
                    >
                      <option value="Petición">Petición (información o trámite)</option>
                      <option value="Queja">Queja (inconformidad con la atención)</option>
                      <option value="Reclamo">Reclamo (problema de producto o factura)</option>
                      <option value="Soporte Técnico">Soporte técnico (falla de sistema)</option>
                      <option value="Sugerencia">Sugerencia</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="radicar-asunto" className="text-xs font-semibold text-[var(--color-text-muted)]">
                    Asunto del requerimiento *
                  </label>
                  <input
                    id="radicar-asunto"
                    type="text"
                    name="asunto"
                    required
                    placeholder="Resumen breve del motivo de su contacto"
                    value={formData.asunto}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="radicar-descripcion" className="text-xs font-semibold text-[var(--color-text-muted)]">
                    Descripción detallada *
                  </label>
                  <textarea
                    id="radicar-descripcion"
                    name="descripcion"
                    required
                    rows={4}
                    placeholder="Explique con claridad los hechos, fechas, números de contrato o factura asociados..."
                    value={formData.descripcion}
                    onChange={handleChange}
                    className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-3 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                  />
                </div>

                <div className="space-y-2 border-t border-[var(--color-border)] pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="file-upload"
                      className="text-xs font-semibold text-[var(--color-text-muted)]"
                    >
                      Adjuntar evidencia o documento (opcional)
                    </label>
                    <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
                      <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                      Análisis automático con DocuMind RAG
                    </span>
                  </div>

                  <div className="rounded-xl bg-[var(--color-bg-main)] p-5 text-center transition-colors hover:bg-[var(--color-surface)]">
                    <input
                      type="file"
                      id="file-upload"
                      className="hidden"
                      accept=".pdf,.docx,.txt"
                      onChange={(event) => setArchivo(event.target.files?.[0] || null)}
                    />
                    <label htmlFor="file-upload" className="block cursor-pointer space-y-2">
                      <UploadCloud
                        className="mx-auto h-7 w-7 text-[var(--color-accent)]"
                        strokeWidth={1.75}
                      />
                      {archivo ? (
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-[var(--color-accent)]">{archivo.name}</p>
                          <p className="text-xs text-[var(--color-text-subtle)]">
                            {(archivo.size / 1024).toFixed(1)} KB · Clic para cambiar
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-medium text-[var(--color-text-muted)]">
                            Arrastre o haga clic para adjuntar su factura, contrato o constancia
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">
                            Soporta PDF, DOCX y TXT hasta 15 MB
                          </p>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-[var(--color-bg-main)] p-3.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={autorizacionDatos}
                    onChange={(event) => setAutorizacionDatos(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span>
                    Autorizo el tratamiento de mis datos personales conforme a la{' '}
                    <strong className="font-semibold text-[var(--color-text)]">Ley 1581 de 2012</strong> y
                    la política de privacidad de la entidad. *
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={enviando || !autorizacionDatos}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] py-3.5 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enviando ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      <span>Procesando solicitud con IA...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" strokeWidth={1.75} />
                      <span>Radicar solicitud oficial</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )
        ) : (
          <div className="mx-auto max-w-xl space-y-8">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                Consulta y trazabilidad de radicados
              </h2>
              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                Consulte el avance público de su solicitud o ingrese su clave privada para acceder
                al expediente completo.
              </p>
            </div>

            <form
              onSubmit={handleConsultar}
              data-tour="tracking-cliente"
              className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl backdrop-blur-xl"
            >
              <div className="space-y-1.5">
                <label htmlFor="tracking-ticket" className="text-xs font-semibold text-[var(--color-text-muted)]">
                  Número de radicado *
                </label>
                <input
                  id="tracking-ticket"
                  type="text"
                  required
                  placeholder="Ej. PQRS-2026-000001"
                  value={ticketQuery}
                  onChange={(event) => setTicketQuery(event.target.value)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 font-mono text-sm uppercase text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="tracking-token" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
                    <Key className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Clave privada de consulta (opcional)
                  </label>
                  <span className="text-[11px] text-[var(--color-text-subtle)]">UUID entregado al radicar</span>
                </div>
                <input
                  id="tracking-token"
                  type="text"
                  placeholder="Ej. a0000000-0000-0000-0000-000000000001"
                  value={tokenQuery}
                  onChange={(event) => setTokenQuery(event.target.value)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                />
                <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  Ingrese la clave privada para visualizar la descripción íntegra y las respuestas
                  de gestión. Si la omite, obtendrá una consulta pública con datos protegidos.
                </p>
              </div>

              <button
                type="submit"
                disabled={buscandoTicket}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] py-3 text-xs font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.99] disabled:opacity-50"
              >
                {buscandoTicket ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    <span>Verificando y consultando...</span>
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" strokeWidth={1.75} />
                    <span>Consultar estado</span>
                  </>
                )}
              </button>
            </form>

            {trackingError ? (
              <div className="flex items-start gap-2.5 rounded-lg bg-rose-50 px-3.5 py-3 text-xs text-rose-600 animate-fade-in">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" strokeWidth={1.75} />
                <span>{trackingError}</span>
              </div>
            ) : null}

            {ticketEncontrado ? (
              <div className="space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl animate-fade-in">
                <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-xs font-bold text-[var(--color-accent)] tabular-nums">
                        {ticketEncontrado.ticket.ticket_id}
                      </span>
                      {ticketEncontrado.es_privado ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                          <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                          Expediente privado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                          <Lock className="h-3 w-3" strokeWidth={1.75} />
                          Vista pública
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-base font-bold text-[var(--color-text)]">
                      {ticketEncontrado.ticket.asunto}
                    </h3>
                  </div>
                  <span className="inline-flex w-fit rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--color-accent)]">
                    {formatEstadoLabel(ticketEncontrado.ticket.estado)}
                  </span>
                </div>

                <dl className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Solicitante</dt>
                    <dd className="mt-0.5 text-[var(--color-text)]">
                      {ticketEncontrado.ticket.nombre_solicitante}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Área responsable</dt>
                    <dd className="mt-0.5 text-[var(--color-text)]">
                      {ticketEncontrado.ticket.departamento}
                    </dd>
                  </div>
                  {ticketEncontrado.ticket.tipo ? (
                    <div>
                      <dt className="text-[var(--color-text-subtle)]">Tipo / prioridad</dt>
                      <dd className="mt-0.5 text-[var(--color-text)]">
                        {ticketEncontrado.ticket.tipo} ·{' '}
                        {ticketEncontrado.ticket.prioridad || 'Media'}
                      </dd>
                    </div>
                  ) : null}
                  {ticketEncontrado.ticket.sla_horas ? (
                    <div>
                      <dt className="text-[var(--color-text-subtle)]">Plazo SLA</dt>
                      <dd className="mt-0.5 font-mono text-[var(--color-accent)] tabular-nums">
                        {ticketEncontrado.ticket.sla_horas} horas
                      </dd>
                    </div>
                  ) : null}
                  {ticketEncontrado.ticket.fecha_radicacion ? (
                    <div className="sm:col-span-2">
                      <dt className="text-[var(--color-text-subtle)]">Fecha de radicación</dt>
                      <dd className="mt-0.5 font-mono text-[var(--color-text-muted)] tabular-nums">
                        {formatFechaHora(ticketEncontrado.ticket.fecha_radicacion)}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {ticketEncontrado.es_privado && ticketEncontrado.ticket.descripcion ? (
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                      <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                      Descripción completa de la solicitud
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text)]">
                      {ticketEncontrado.ticket.descripcion}
                    </p>
                  </div>
                ) : !ticketEncontrado.es_privado ? (
                  <div className="flex items-start gap-2 border-l-2 border-amber-500 pl-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={1.75} />
                    <span>
                      La descripción y los datos privados están protegidos. Ingrese su clave privada
                      para acceder al expediente completo.
                    </span>
                  </div>
                ) : null}

                {ticketEncontrado.es_privado &&
                ticketEncontrado.documentos &&
                ticketEncontrado.documentos.length > 0 ? (
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                      <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                      Documentos y evidencias adjuntas
                      <span className="font-mono text-[var(--color-text-subtle)] tabular-nums">
                        ({ticketEncontrado.documentos.length})
                      </span>
                    </p>
                    <div className="mt-2 divide-y divide-[var(--color-border)]">
                      {ticketEncontrado.documentos.map((documento) => (
                        <div
                          key={documento.id}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText
                              className="h-4 w-4 shrink-0 text-[var(--color-accent)]"
                              strokeWidth={1.75}
                            />
                            <span className="truncate font-mono text-[11px] text-[var(--color-text)]">
                              {documento.nombre_archivo}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] uppercase text-[var(--color-text-subtle)]">
                              {documento.tipo_formato}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDescargarDocCiudadano(documento)}
                            disabled={descargandoDocId === documento.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--color-bg-main)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-surface)] active:scale-[0.98] disabled:opacity-50"
                          >
                            {descargandoDocId === documento.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                            ) : (
                              <Download className="h-3 w-3" strokeWidth={1.75} />
                            )}
                            Descargar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-[var(--color-border)] pt-4">
                  <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    <Clock className="h-3.5 w-3.5 text-[var(--color-text-subtle)]" strokeWidth={1.75} />
                    Historial de atención oficial
                  </h4>
                  <ol className="mt-3 space-y-4 border-l border-[var(--color-border)] pl-4">
                    {ticketEncontrado.timeline?.filter((actividad) => !actividad.es_nota_interna)
                      .length ? (
                      ticketEncontrado.timeline
                        .filter((actividad) => !actividad.es_nota_interna)
                        .map((actividad) => (
                          <li key={actividad.id || actividad.created_at} className="text-xs">
                            <p className="font-medium text-[var(--color-accent)]">
                              {actividad.autor_nombre}
                              {actividad.estado_nuevo
                                ? ` · ${formatEstadoLabel(actividad.estado_nuevo)}`
                                : ''}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--color-text-muted)]">
                              {actividad.mensaje}
                            </p>
                          </li>
                        ))
                    ) : (
                      <li className="text-xs italic text-[var(--color-text-subtle)]">
                        No hay actividades públicas registradas todavía.
                      </li>
                    )}
                  </ol>
                </div>

                {ticketEncontrado.es_privado ? (
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                        <Star className="h-3.5 w-3.5 text-amber-600" strokeWidth={1.75} />
                        Calificación de satisfacción
                      </h4>
                      {ticketEncontrado.ticket.satisfaccion_score ? (
                        <span className="text-[11px] text-emerald-600 tabular-nums">
                          Registrada: {ticketEncontrado.ticket.satisfaccion_score}/5
                        </span>
                      ) : null}
                    </div>

                    {puedeCalificar ? (
                      <form onSubmit={handleCalificar} className="mt-3 space-y-3">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((valor) => (
                            <button
                              key={valor}
                              type="button"
                              onClick={() => setCsatRating(valor)}
                              aria-label={`Calificar con ${valor} ${valor === 1 ? 'estrella' : 'estrellas'}`}
                              aria-pressed={csatRating === valor}
                              className={`rounded-md p-1 transition-colors active:scale-[0.96] ${
                                valor <= csatRating
                                  ? 'text-amber-600 hover:text-amber-500'
                                  : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]'
                              }`}
                            >
                              <Star
                                className="h-7 w-7"
                                strokeWidth={1.75}
                                fill={valor <= csatRating ? 'currentColor' : 'none'}
                              />
                            </button>
                          ))}
                          <span className="ml-2 text-xs text-[var(--color-text-muted)] tabular-nums">
                            {csatRating ? `${csatRating} de 5` : 'Seleccione una calificación'}
                          </span>
                        </div>

                        <textarea
                          value={csatComentario}
                          onChange={(event) => setCsatComentario(event.target.value)}
                          rows={2}
                          placeholder="Comentario opcional sobre la atención recibida..."
                          className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] px-3.5 py-2.5 text-xs text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-amber-500"
                        />

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="submit"
                            disabled={!csatRating || enviandoCsat}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {enviandoCsat ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                            ) : (
                              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                            )}
                            {enviandoCsat ? 'Registrando...' : 'Enviar calificación'}
                          </button>
                          {csatMensaje ? (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {csatMensaje}
                            </span>
                          ) : null}
                          {csatError ? (
                            <span className="flex items-center gap-1 text-[11px] text-rose-600">
                              <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {csatError}
                            </span>
                          ) : null}
                        </div>
                      </form>
                    ) : (
                      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-subtle)]">
                        La calificación estará disponible cuando el radicado se encuentre en estado
                        Resuelto o Cerrado.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </main>

      <footer className="border-t border-[var(--color-border)] px-4 py-6 text-center text-[11px] text-[var(--color-text-subtle)]">
        <p>DocuMind Enterprise 2026 · Plataforma integral de automatización e IA documental</p>
      </footer>
    </div>
  );
}
