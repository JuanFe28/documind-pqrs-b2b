import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Send,
  FileText,
  FileStack,
  Bot,
  User,
  Loader2,
  MessageSquare,
  Trash2,
  AlertCircle,
  Filter,
  Paperclip,
  Plus,
  MessageCircle,
  Eye,
  X,
  Camera,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Timer,
  Cpu,
  Unlink,
} from 'lucide-react';
import { chatAPI, repositoriesAPI, automationAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatEstadoLabel, formatPrioridadLabel } from '../utils/pqrs';

const REPO_NORMATIVA_SLUG = 'normativa-pqrs';
const REPO_NORMATIVA_DEPARTAMENTO = 'Normativa PQRS';
const REPO_NORMATIVA_ID = 3;

function esRepositorioNormativa(repo) {
  if (!repo) return false;
  return (
    repo.slug === REPO_NORMATIVA_SLUG ||
    repo.departamento === REPO_NORMATIVA_DEPARTAMENTO ||
    Number(repo.id) === REPO_NORMATIVA_ID
  );
}

async function copiarAlPortapapeles(texto) {
  if (!texto) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
    } else {
      const area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    return true;
  } catch {
    return false;
  }
}

function extraerMetaRespuesta(data) {
  const latencia = data?.latencia_ms ?? data?.latencia ?? null;
  const modelo = data?.modelo_usado ?? data?.modelo_utilizado ?? data?.modelo ?? null;
  return {
    latencia_ms: latencia !== null && latencia !== undefined ? Number(latencia) : null,
    modelo_usado: typeof modelo === 'string' && modelo.trim() ? modelo.trim() : null,
  };
}

function TypingIndicator({ estado, enCola = 0 }) {
  return (
    <div className="flex items-start justify-start gap-3 animate-fade-in">
      <div className="flex-shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-2">
        <Bot className="h-5 w-5 text-[var(--color-accent)]" strokeWidth={1.75} />
      </div>
      <div className="rounded-2xl rounded-tl-none border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)]">
          <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
          DocuMind Gemini Engine
        </p>
        <div className="flex items-center gap-1.5">
          <div className="typing-dot" style={{ animationDelay: '0ms' }} />
          <div className="typing-dot" style={{ animationDelay: '150ms' }} />
          <div className="typing-dot" style={{ animationDelay: '300ms' }} />
          <span className="ml-1 text-xs text-[var(--color-text-muted)]" aria-live="polite">
            {estado || 'Consultando documentos...'}
          </span>
          {enCola > 0 ? (
            <span className="ml-1 rounded-full bg-[var(--color-bg-main)] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-text-muted)]">
              {enCola} en cola
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MensajeUsuario({ texto, nombre, imagen }) {
  return (
    <div className="flex items-start justify-end gap-3 animate-slide-right">
      <div className="max-w-xl rounded-2xl rounded-tr-none bg-[var(--color-accent)] p-4 text-white shadow-sm">
        <p className="mb-1 text-xs font-semibold text-white/75">{nombre} (Analista)</p>
        {imagen && (
          <div className="mb-2.5 max-h-56 overflow-hidden rounded-xl border border-white/25 bg-black/15">
            <img src={imagen} alt="Adjunto de visión" className="h-auto max-h-56 w-full object-contain" />
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{texto}</p>
      </div>
      <div className="flex-shrink-0 rounded-full bg-[var(--color-accent-soft)] p-2">
        <User className="h-5 w-5 text-[var(--color-accent)]" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function MensajeIA({
  respuesta,
  fuentes,
  datos_vision,
  borrador_respuesta,
  onRadicarTicket,
  onViewDoc,
  latencia_ms,
  modelo_usado,
}) {
  const [radicando, setRadicando] = useState(false);
  const [resultadoRadicacion, setResultadoRadicacion] = useState(null);
  const [errorRadicacion, setErrorRadicacion] = useState(null);
  const [revisionConfirmada, setRevisionConfirmada] = useState(false);
  const [borradorCopiado, setBorradorCopiado] = useState(false);
  const borradorTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (borradorTimerRef.current) window.clearTimeout(borradorTimerRef.current);
    },
    []
  );

  const handleCopiarBorrador = async () => {
    const copiado = await copiarAlPortapapeles(borrador_respuesta);
    if (!copiado) return;
    setBorradorCopiado(true);
    if (borradorTimerRef.current) window.clearTimeout(borradorTimerRef.current);
    borradorTimerRef.current = window.setTimeout(() => setBorradorCopiado(false), 2200);
  };

  const latenciaNumero = Number(latencia_ms);
  const latenciaTexto =
    latencia_ms !== null && latencia_ms !== undefined && Number.isFinite(latenciaNumero)
      ? `${latenciaNumero.toLocaleString('es-CO')} ms`
      : null;
  const modeloTexto = modelo_usado || null;

  const requiereRevision = !!datos_vision?.requiere_revision_humana;

  const handleRadicarClick = async () => {
    if (!datos_vision || radicando || resultadoRadicacion) return;
    if (requiereRevision && !revisionConfirmada) {
      setErrorRadicacion('Debe confirmar la verificación de los datos extraídos antes de radicar.');
      return;
    }
    setRadicando(true);
    setErrorRadicacion(null);
    try {
      const res = await onRadicarTicket(datos_vision);
      setResultadoRadicacion(res);
    } catch (err) {
      setErrorRadicacion(err.response?.data?.mensaje || err.message || 'No se pudo radicar la solicitud.');
    } finally {
      setRadicando(false);
    }
  };

  const scorePct = datos_vision?.score_confianza ? Math.round(datos_vision.score_confianza * 100) : null;
  const esConfiable = datos_vision && !datos_vision.requiere_revision_humana && (datos_vision.score_confianza >= 0.85);

  return (
    <div className="flex items-start justify-start gap-3 animate-slide-left">
      <div className="flex-shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-2">
        <Bot className="h-5 w-5 text-[var(--color-accent)]" strokeWidth={1.75} />
      </div>
      <div className="w-full max-w-2xl rounded-2xl rounded-tl-none border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)]">
            <span className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
              DocuMind Gemini Engine
            </span>
            {datos_vision && (
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
                IA Multimodal de Visión
              </span>
            )}
          </p>
          {scorePct !== null && (
            <span className={`rounded-full border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2 py-0.5 text-[10px] font-bold ${
              esConfiable 
                ? 'text-[var(--color-success)]' 
                : 'text-[var(--color-text-muted)]'
            }`}>
              <span className="inline-flex items-center gap-1">
                {esConfiable ? (
                  <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
                ) : (
                  <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                )}
                {esConfiable ? 'Confianza' : 'Revisar'} {scorePct}%
              </span>
            </span>
          )}
        </div>

        <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
          {respuesta}
        </div>

        {borrador_respuesta ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopiarBorrador}
              aria-live="polite"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[11px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]"
            >
              {borradorCopiado ? (
                <Check className="h-3.5 w-3.5 text-[var(--color-success)]" strokeWidth={1.75} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {borradorCopiado ? 'Borrador copiado' : 'Copiar borrador para cliente'}
            </button>
          </div>
        ) : null}

        {/* Tarjeta de Acción Interactiva para Visión: Radicar directamente en PQRS */}
        {datos_vision && (
          <div className="mt-4 border-t border-[var(--color-border)] pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                Automatización PQRS (Ruta A)
              </span>
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {datos_vision.datos_extraidos?.tipo_solicitud} · {datos_vision.datos_extraidos?.prioridad_sugerida}
              </span>
            </div>

            {resultadoRadicacion ? (
              <div className="mt-2 space-y-1 border-l-2 border-[var(--color-success)] pl-3 text-xs text-[var(--color-success)] animate-fade-in">
                <div className="flex items-center gap-1.5 font-bold text-[var(--color-text)]">
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" strokeWidth={1.75} />
                  ¡Solicitud radicada con éxito en el sistema!
                </div>
                <div className="grid grid-cols-2 gap-1 pt-1 font-mono text-[11px]">
                  <div>Radicado: <strong>{resultadoRadicacion.ticket_id}</strong></div>
                  <div>SLA: <strong>{resultadoRadicacion.sla_horas}h</strong></div>
                  <div className="col-span-2 truncate">Token: {resultadoRadicacion.tracking_token}</div>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-2">
                {requiereRevision && (
                  <label className="flex cursor-pointer items-start gap-2 border-l-2 border-amber-400 pl-2.5 text-[11px] text-[var(--color-text-muted)]">
                    <input
                      type="checkbox"
                      checked={revisionConfirmada}
                      onChange={(e) => setRevisionConfirmada(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-amber-600 flex-shrink-0"
                    />
                    <span>Confirmo que he verificado los datos extraídos (confianza &lt; 85%)</span>
                  </label>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {esConfiable 
                      ? '¿Desea crear el requerimiento oficial con estos datos extraídos?' 
                      : 'Revise los campos dudosos y confirme para registrar el caso.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleRadicarClick}
                    disabled={radicando || (requiereRevision && !revisionConfirmada)}
                    className="btn-primary text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm whitespace-nowrap disabled:opacity-60"
                  >
                  {radicando ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Radicando...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Radicar en PQRS
                    </>
                  )}
                  </button>
                </div>
              </div>
            )}

            {errorRadicacion && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] font-medium text-[var(--color-danger)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{errorRadicacion}</span>
              </p>
            )}
          </div>
        )}

        {/* Caja de citación obligatoria */}
        {fuentes && fuentes.length > 0 && (
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <div className="mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} />
              <span className="text-xs font-semibold text-[var(--color-accent)]">Fuentes Citadas</span>
            </div>
            <div className="space-y-1">
              {fuentes.map((f, i) => (
                <div key={i} className="group flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <div className="flex min-w-0 items-center gap-2 truncate">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <span className="truncate italic" title={f.nombre_archivo}>
                      {f.nombre_archivo} (Pág {f.pagina})
                    </span>
                    {f.score && (
                      <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-subtle)]">
                        {(f.score * 100).toFixed(0)}% relevancia
                      </span>
                    )}
                  </div>
                  {f.url_descarga && (
                    <button 
                      onClick={() => onViewDoc(f.url_descarga, f.nombre_archivo)}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-[var(--color-bg-main)] group-hover:opacity-100"
                      title="Ver Documento Original"
                    >
                      <Eye className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(latenciaTexto || modeloTexto) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-3 text-[10px] font-medium text-[var(--color-text-subtle)]">
            {latenciaTexto ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Timer className="h-3 w-3" strokeWidth={1.75} />
                {latenciaTexto}
              </span>
            ) : null}
            {modeloTexto ? (
              <span className="inline-flex items-center gap-1 truncate">
                <Cpu className="h-3 w-3" strokeWidth={1.75} />
                {modeloTexto}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BannerExpediente({ ticketId, contexto, onVolver, onDesvincular }) {
  const adjuntos = Array.isArray(contexto?.adjuntos) ? contexto.adjuntos : [];
  const normativa = Array.isArray(contexto?.normativa_aplicada) ? contexto.normativa_aplicada : [];
  const nombresAdjuntos = adjuntos.map((adjunto) => adjunto.nombre_archivo).filter(Boolean).join(', ');

  return (
    <div
      role="region"
      aria-label="Expediente PQRS conectado"
      className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <FileStack className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-subtle)]">
              Expediente PQRS Conectado
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
              <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--color-accent)]">
                {ticketId}
              </span>
              {contexto?.estado ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                  {formatEstadoLabel(contexto.estado)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                  Sincronizando contexto
                </span>
              )}
              {contexto?.prioridad ? (
                <span>Prioridad {formatPrioridadLabel(contexto.prioridad)}</span>
              ) : null}
              {contexto?.departamento ? <span className="truncate">{contexto.departamento}</span> : null}
              {contexto?.sla_horas !== undefined && contexto?.sla_horas !== null ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Timer className="h-3 w-3" strokeWidth={1.75} />
                  {contexto.sla_horas} h SLA
                </span>
              ) : null}
              <span
                className="inline-flex items-center gap-1 tabular-nums"
                title={nombresAdjuntos || 'Sin adjuntos vinculados'}
              >
                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                {adjuntos.length} {adjuntos.length === 1 ? 'adjunto' : 'adjuntos'}
              </span>
              {normativa.length > 0 ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                  {normativa.length} {normativa.length === 1 ? 'fuente normativa' : 'fuentes normativas'}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onVolver}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[11px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Volver a PQRS
          </button>
          <button
            type="button"
            onClick={onDesvincular}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-rose-500/10 hover:text-[var(--color-danger)] active:scale-[0.98]"
          >
            <Unlink className="h-3.5 w-3.5" strokeWidth={1.75} />
            Desvincular
          </button>
        </div>
      </div>
    </div>
  );
}

const MENSAJE_BIENVENIDA = {
  tipo: 'ia',
  respuesta: `Hola. Soy **DocuMind**, tu asistente conversacional con inteligencia documental y **visión multimodal**.\n\nPuedo responder preguntas, comparar contratos, resolver dudas normativas y **procesar imágenes de formularios físicos o evidencias de novedades** directamente desde esta conversación.\n\nPrueba:\n\n• **Visión Multimodal:** Adjunta la foto de un formulario físico o novedad con el botón de cámara y extraeré los campos con opción de radicación inmediata en PQRS.\n• **Comparación:** *"Compara el contrato de outsourcing IT con el de soporte hosting"*\n• **Resolución PQRS:** *"¿Cómo resolver un requerimiento de facturación duplicada según los manuales?"*\n\n*Nota: Respondo con citas a documentos y datos estructurados verificados.*`,
  fuentes: [],
};

export default function ChatRAG({ selectedRepo }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQueryProcessed = useRef(false);

  const [mensajes, setMensajes] = useState([MENSAJE_BIENVENIDA]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [estadoEnvio, setEstadoEnvio] = useState('');
  const [colaPendiente, setColaPendiente] = useState([]);
  const [error, setError] = useState('');
  const [repositorios, setRepositorios] = useState([]);
  // Por defecto, buscar en todos los repositorios para máxima cobertura en comparaciones
  const [filtroRepoId, setFiltroRepoId] = useState('');
  const [activeTicketId, setActiveTicketId] = useState('');
  const [contextoExpediente, setContextoExpediente] = useState(null);
  const [repositoriosListos, setRepositoriosListos] = useState(false);
  const [repoNormativaSolicitado, setRepoNormativaSolicitado] = useState(false);

  const procesandoRef = useRef(false);
  const colaRef = useRef([]);
  const activeThreadIdRef = useRef(null);
  const cargarThreadIgnoradoRef = useRef(null);
  const progresoTimersRef = useRef([]);
  
  // Hilos de chat
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);

  // Soporte para visión multimodal en chat
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError('La imagen excede el límite de 15 MB.');
      return;
    }
    setSelectedImage(file);
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
    setError('');
  };

  const handleRemoveImage = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setSelectedImage(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    chatAPI.warmup().catch(() => {
      // El precalentamiento es best-effort: nunca debe bloquear el chat.
    });
  }, []);

  const limpiarProgreso = () => {
    progresoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    progresoTimersRef.current = [];
    setEstadoEnvio('');
  };

  const iniciarProgreso = (conImagen) => {
    limpiarProgreso();
    const pasos = conImagen
      ? [
          'Analizando imagen con visión multimodal...',
          'Extrayendo campos y calculando confianza...',
          'Validando datos para radicación...',
        ]
      : [
          'Interpretando la consulta...',
          'Buscando evidencia documental...',
          'Redactando respuesta con citas...',
        ];

    setEstadoEnvio(pasos[0]);
    pasos.slice(1).forEach((texto, indice) => {
      progresoTimersRef.current.push(
        window.setTimeout(() => setEstadoEnvio(texto), (indice + 1) * 1400)
      );
    });
  };

  useEffect(
    () => () => {
      progresoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      progresoTimersRef.current = [];
    },
    []
  );

  const handleRadicarTicket = async (datosVision) => {
    const d = datosVision.datos_extraidos || {};
    const nombreSolicitante = d.nombre_solicitante || 'Ciudadano Anónimo';
    const emailSolicitante = d.email_solicitante || 'contacto@empresa.com';
    const areaSugerida = d.area_sugerida || 'Soporte Técnico y Sistemas';
    const payload = {
      request_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'req-' + Date.now(),
      nombre_solicitante: nombreSolicitante,
      nombre: nombreSolicitante,
      email_solicitante: emailSolicitante,
      email: emailSolicitante,
      telefono: d.telefono_solicitante || '',
      tipo_solicitud: d.tipo_solicitud || 'Petición',
      prioridad: d.prioridad_sugerida || 'Media',
      departamento: areaSugerida,
      area: areaSugerida,
      asunto: d.asunto || 'Requerimiento digitalizado por Visión IA',
      descripcion: d.descripcion || 'Digitalización y radicación directa desde Chatbot',
    };

    const res = await automationAPI.radicar(payload);
    return res.data;
  };
  
  // Visor de documentos con ciclo de vida seguro de Object URL
  const [docViewerUrl, setDocViewerUrl] = useState(null);
  const [docViewerTitle, setDocViewerTitle] = useState('');
  const [docBlobUrl, setDocBlobUrl] = useState(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const docBlobUrlRef = useRef(null);

  useEffect(() => {
    if (docBlobUrlRef.current) {
      URL.revokeObjectURL(docBlobUrlRef.current);
      docBlobUrlRef.current = null;
    }

    if (!docViewerUrl) {
      setDocBlobUrl(null);
      return;
    }

    const abortController = new AbortController();
    setLoadingDoc(true);
    const token = localStorage.getItem('documind_token');
    const fullUrl = docViewerUrl.startsWith('http') ? docViewerUrl : `http://localhost:5000${docViewerUrl}`;

    fetch(fullUrl, {
      signal: abortController.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Error al cargar documento`);
        return res.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        docBlobUrlRef.current = objectUrl;
        setDocBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.error('Error fetching document blob:', err);
        setDocBlobUrl(null);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoadingDoc(false);
        }
      });

    return () => {
      abortController.abort();
      if (docBlobUrlRef.current) {
        URL.revokeObjectURL(docBlobUrlRef.current);
        docBlobUrlRef.current = null;
      }
    };
  }, [docViewerUrl]);

  const chatEndRef = useRef(null);

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        const res = await repositoriesAPI.list();
        setRepositorios(res.data.repositorios || []);
      } catch {
        setRepositorios([]);
      } finally {
        setRepositoriosListos(true);
      }
    };
    fetchRepos();
  }, [user?.id]);

  useEffect(() => {
    if (!repoNormativaSolicitado || !repositoriosListos) return;
    const repo = repositorios.find(esRepositorioNormativa);
    if (repo) setFiltroRepoId(String(repo.id));
    setRepoNormativaSolicitado(false);
  }, [repoNormativaSolicitado, repositoriosListos, repositorios]);

  useEffect(() => {
    if (selectedRepo) {
      setFiltroRepoId(String(selectedRepo.id));
    }
  }, [selectedRepo]);

  // Cargar threads
  useEffect(() => {
    const fetchThreads = async () => {
      try {
        setLoadingThreads(true);
        const res = await chatAPI.getThreads(filtroRepoId ? parseInt(filtroRepoId) : null);
        setThreads(res.data.threads || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingThreads(false);
      }
    };
    fetchThreads();
  }, [filtroRepoId, user?.id]);

  // Cargar mensajes del thread activo
  useEffect(() => {
    const fetchMessages = async () => {
      if (!activeThreadId) {
        setMensajes([MENSAJE_BIENVENIDA]);
        return;
      }
      if (cargarThreadIgnoradoRef.current === activeThreadId) {
        cargarThreadIgnoradoRef.current = null;
        return;
      }
      try {
        setLoading(true);
        const res = await chatAPI.getMessages(activeThreadId);
        const msgs = res.data.messages.map(m => ({
          tipo: m.rol === 'user' ? 'usuario' : 'ia',
          texto: m.rol === 'user' ? m.contenido : undefined,
          respuesta: m.rol === 'ia' ? m.contenido : undefined,
          fuentes: m.fuentes,
          latencia_ms: m.latencia_ms ?? m.latencia ?? null,
          modelo_usado: m.modelo_usado ?? m.modelo_utilizado ?? null,
        }));
        setMensajes(msgs.length ? msgs : [MENSAJE_BIENVENIDA]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [activeThreadId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, loading]);

  const createThread = async (queryText, repoIdToUse = null) => {
    try {
      const textoBase = (queryText || 'Nueva conversación').trim();
      const title = textoBase.length > 30 ? textoBase.substring(0, 30) + '...' : textoBase;
      const repoVal = repoIdToUse !== null ? repoIdToUse : (filtroRepoId ? parseInt(filtroRepoId) : null);
      const res = await chatAPI.createThread(title, repoVal);
      const newThread = res.data.thread;
      setThreads(prev => [newThread, ...prev]);
      activeThreadIdRef.current = newThread.id;
      cargarThreadIgnoradoRef.current = newThread.id;
      setActiveThreadId(newThread.id);
      return newThread.id;
    } catch (err) {
      console.error('Error al crear thread', err);
      return null;
    }
  };

  const procesarItem = async (item) => {
    if (!item) return;

    procesandoRef.current = true;
    setLoading(true);
    setError('');
    iniciarProgreso(Boolean(item.image));

    try {
      let currentThreadId = activeThreadIdRef.current;
      if (!currentThreadId) {
        setEstadoEnvio('Creando hilo de conversación...');
        currentThreadId = await createThread(item.tituloHilo, item.repoId);
      }

      if (item.image) {
        setEstadoEnvio('Analizando imagen y extrayendo campos...');
        const formData = new FormData();
        formData.append('archivo', item.image);
        formData.append('query', item.query || '');
        if (currentThreadId) formData.append('thread_id', currentThreadId);

        const res = await chatAPI.queryMultimodal(formData);
        const data = res.data || {};
        const meta = extraerMetaRespuesta(data);

        setMensajes((prev) => [
          ...prev,
          {
            tipo: 'ia',
            respuesta: data.respuesta,
            fuentes: data.fuentes_citadas || [],
            datos_vision: data.datos_vision,
            ...meta,
          },
        ]);
      } else {
        setEstadoEnvio('Buscando evidencia documental...');
        const payloadConsulta = {
          query: item.query,
          repositorio_id: item.repoId || undefined,
          thread_id: currentThreadId,
        };
        if (item.ticketId) payloadConsulta.ticket_id = item.ticketId;

        const res = await chatAPI.query(payloadConsulta);
        const data = res.data || {};
        const meta = extraerMetaRespuesta(data);
        setEstadoEnvio('Redactando respuesta con citas...');

        const contexto = data.contexto_ticket || null;
        const borrador = typeof data.borrador_respuesta === 'string' ? data.borrador_respuesta : '';
        if (contexto) setContextoExpediente(contexto);

        setMensajes((prev) => [
          ...prev,
          {
            tipo: 'ia',
            respuesta: data.respuesta,
            fuentes: data.fuentes_citadas || [],
            contexto_ticket: contexto,
            borrador_respuesta: borrador,
            ...meta,
          },
        ]);
      }
    } catch (err) {
      const msg = err.response?.data?.mensaje || 'Error en el motor RAG / Visión. Intenta nuevamente.';
      setError(msg);
      setMensajes((prev) => [
        ...prev,
        {
          tipo: 'ia',
          respuesta: `No se pudo completar la consulta: ${msg}`,
          fuentes: [],
        },
      ]);
    } finally {
      limpiarProgreso();
      setLoading(false);
      const siguiente = colaRef.current.shift() || null;
      setColaPendiente(colaRef.current.slice());
      procesandoRef.current = Boolean(siguiente);
      if (siguiente) {
        window.setTimeout(() => procesarItem(siguiente), 220);
      }
    }
  };

  const handleSend = async (overrideQuery = null, overrideRepoId = null, overrideTicketId = undefined) => {
    const query = (overrideQuery ?? inputText).trim();
    const currentImage = selectedImage;
    const currentPreview = imagePreviewUrl;
    if (!query && !currentImage) return;

    setInputText('');
    setSelectedImage(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError('');

    setMensajes((prev) => [
      ...prev,
      {
        tipo: 'usuario',
        texto: query || 'Foto de formulario físico o evidencia adjunta para digitalización',
        imagen: currentPreview,
      },
    ]);

    const effectiveRepoId = overrideRepoId !== null
      ? overrideRepoId
      : (filtroRepoId ? parseInt(filtroRepoId) : null);
    const textoHilo = query || `Formulario ${currentImage?.name || 'Visión IA'}`;
    const tituloHilo = textoHilo.length > 30 ? `${textoHilo.substring(0, 30)}...` : textoHilo;

    const item = {
      query,
      image: currentImage,
      repoId: effectiveRepoId,
      tituloHilo,
      ticketId: overrideTicketId !== undefined ? overrideTicketId : activeTicketId || null,
    };

    if (procesandoRef.current) {
      colaRef.current.push(item);
      setColaPendiente(colaRef.current.slice());
      return;
    }

    await procesarItem(item);
  };

  // Escuchar consultas redirigidas automáticamente desde la Mesa de Ayuda PQRS
  useEffect(() => {
    if (urlQueryProcessed.current) return;

    const q = searchParams.get('q') || searchParams.get('query');
    const ticketParam = (searchParams.get('ticket_id') || searchParams.get('ticket') || '').trim();
    const targetRepo = searchParams.get('repo');
    const repoEsNormativa = targetRepo === 'normativa';

    if (!q && !ticketParam && !targetRepo) return;

    if (ticketParam) {
      setActiveTicketId(ticketParam);
      setContextoExpediente((prev) => prev || { ticket_id: ticketParam });
    }

    if (repoEsNormativa) setRepoNormativaSolicitado(true);

    let repoId = null;
    if (repoEsNormativa) {
      const repo = repositorios.find(esRepositorioNormativa);
      if (repo) {
        repoId = Number(repo.id);
      } else if (!repositoriosListos) {
        return;
      }
    } else if (targetRepo && targetRepo !== 'all') {
      const parsed = Number.parseInt(targetRepo, 10);
      if (Number.isFinite(parsed) && parsed > 0) repoId = parsed;
    }

    urlQueryProcessed.current = true;

    if (q) {
      setFiltroRepoId(repoId ? String(repoId) : '');
      handleSend(q, repoId, ticketParam || null);
    } else if (repoId) {
      setFiltroRepoId(String(repoId));
    }

    setSearchParams({}, { replace: true });
  }, [searchParams, repositorios, repositoriosListos]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const limpiarChat = () => {
    colaRef.current = [];
    setColaPendiente([]);
    setActiveThreadId(null);
    setMensajes([MENSAJE_BIENVENIDA]);
    setError('');
  };

  const handleDeleteThread = async (e, threadId) => {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar esta conversación?')) return;
    try {
      await chatAPI.deleteThread(threadId);
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (activeThreadId === threadId) limpiarChat();
    } catch (err) {
      console.error('Error al eliminar hilo', err);
    }
  };

  const desvincularExpediente = () => {
    setActiveTicketId('');
    setContextoExpediente(null);
  };

  const preguntasRapidas = [
    'Compara el contrato de outsourcing IT con el de soporte hosting',
    'Compara el contrato de papelería con el de seguridad privada',
    '¿Cuáles son las penalizaciones del contrato de servicios oriente?',
    'Procedimiento y plazos para resolver quejas sobre garantías de producto',
  ];

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 w-full overflow-hidden bg-[var(--color-bg-main)]">
      
      {/* Sidebar Historial */}
      <div className="hidden w-64 flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Historial de Chat</h2>
          <button 
            onClick={limpiarChat}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]"
            title="Nuevo Chat"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {loadingThreads ? (
            <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-subtle)]" strokeWidth={1.75} /></div>
          ) : threads.length === 0 ? (
            <p className="p-4 text-center text-xs text-[var(--color-text-subtle)]">No hay conversaciones previas</p>
          ) : (
            threads.map(t => (
              <div
                key={t.id}
                className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg p-2.5 text-left text-xs transition-colors ${activeThreadId === t.id ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)]'}`}
                onClick={() => setActiveThreadId(t.id)}
              >
                <MessageCircle className={`h-3.5 w-3.5 flex-shrink-0 ${activeThreadId === t.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-subtle)]'}`} strokeWidth={1.75} />
                <span className={`flex-1 truncate ${activeThreadId === t.id ? 'font-semibold' : ''}`}>{t.titulo}</span>
                <button
                  onClick={(e) => handleDeleteThread(e, t.id)}
                  className="flex-shrink-0 rounded p-0.5 text-[var(--color-text-subtle)] opacity-0 transition-all hover:bg-rose-500/10 hover:text-[var(--color-danger)] group-hover:opacity-100"
                  title="Eliminar conversación"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div id="pantalla-chat" className="flex h-full min-w-0 flex-1 flex-col">
        {/* Header del chat */}
        <div className="flex flex-shrink-0 flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-[var(--color-text)] sm:text-xl">
              <MessageSquare className="h-5 w-5 shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} />
              <span className="truncate">Chat Conversacional RAG Inteligente</span>
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Consultas en lenguaje natural con citas y trazabilidad documental
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Selector de Repositorio en Chat */}
            <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2.5 py-1.5 text-xs text-[var(--color-text)]">
              <Filter className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} />
              <select
                value={filtroRepoId}
                onChange={(e) => setFiltroRepoId(e.target.value)}
                className="min-w-0 max-w-[220px] cursor-pointer border-none bg-transparent text-xs font-medium text-[var(--color-text)] outline-none"
              >
                <option value="">Todos los repositorios</option>
                {repositorios.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre} ({r.departamento})
                  </option>
                ))}
              </select>
            </div>

            <button
              id="btn-limpiar-chat"
              onClick={limpiarChat}
              className="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:bg-rose-500/10 hover:text-[var(--color-danger)] active:scale-[0.98]"
              title="Limpiar conversación"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Limpiar
            </button>
          </div>
        </div>

        {activeTicketId ? (
          <BannerExpediente
            ticketId={activeTicketId}
            contexto={contextoExpediente}
            onVolver={() => navigate('/pqrs')}
            onDesvincular={desvincularExpediente}
          />
        ) : null}

        {/* Área de mensajes */}
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {mensajes.map((msg, i) =>
            msg.tipo === 'usuario' ? (
              <MensajeUsuario 
                key={i} 
                texto={msg.texto} 
                nombre={user?.nombre || 'Usuario'} 
                imagen={msg.imagen}
              />
            ) : (
              <MensajeIA 
                key={i} 
                respuesta={msg.respuesta} 
                fuentes={msg.fuentes} 
                datos_vision={msg.datos_vision}
                borrador_respuesta={msg.borrador_respuesta}
                latencia_ms={msg.latencia_ms}
                modelo_usado={msg.modelo_usado}
                onRadicarTicket={handleRadicarTicket}
                onViewDoc={(url, title) => {
                  console.log('[DocViewer] url_descarga recibida:', url, '| archivo:', title);
                  setDocViewerUrl(url);
                  setDocViewerTitle(title);
                }} 
              />
            )
          )}
          {loading && <TypingIndicator estado={estadoEnvio} enCola={colaPendiente.length} />}
          <div ref={chatEndRef} />
        </div>

        {/* Sugerencias rápidas (cuando hay pocos mensajes) */}
        {mensajes.length <= 1 && !loading && colaPendiente.length === 0 && (
          <div className="flex-shrink-0 px-4 pb-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap gap-2">
              {preguntasRapidas.map((p, i) => (
                <button
                  key={i}
                  id={`sugerencia-${i}`}
                  onClick={() => {
                    handleSend(p);
                  }}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-left text-xs text-[var(--color-text-muted)] shadow-sm transition-all hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] hover:scale-[1.02] active:scale-[0.98]"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input de envío */}
        <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
              {error}
            </div>
          )}

          {colaPendiente.length > 0 && (
            <div className="mb-2 flex w-fit items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
              <MessageSquare className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
              <span className="tabular-nums">
                {colaPendiente.length} {colaPendiente.length === 1 ? 'consulta en cola' : 'consultas en cola'}
              </span>
              <span className="text-[var(--color-text-subtle)]">· se procesarán en orden</span>
            </div>
          )}

          {/* Chip de previsualización de imagen adjunta */}
          {selectedImage && (
            <div className="mb-2 flex w-fit max-w-full items-center gap-3 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 animate-fade-in">
              <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                <img src={imagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 text-xs">
                <p className="max-w-xs truncate font-semibold text-[var(--color-text)]">{selectedImage.name}</p>
                <p className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {(selectedImage.size / 1024).toFixed(0)} KB · Formulario / Evidencia Física
                </p>
              </div>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="ml-1 flex-shrink-0 rounded-full p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]"
                title="Quitar imagen"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
          )}

          <div data-tour="chat-rag" className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-2 transition-all focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent-ring)] sm:gap-3">
            {/* Botón de carga de fotos para Visión Multimodal */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 rounded-xl p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)] active:scale-[0.98]"
              title="Adjuntar foto de formulario físico o evidencia (Visión Multimodal)"
            >
              <Camera className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleImageSelect}
            />

            <div className="flex items-center text-[var(--color-text-subtle)]">
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <textarea
              id="input-chat-query"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                loading
                  ? "Escriba otra consulta para añadirla a la cola..."
                  : selectedImage 
                    ? "Escriba una pregunta sobre la imagen o presione Enter para digitalizar..." 
                    : "Escriba su consulta o adjunte una foto de formulario con el icono de cámara..."
              }
              rows={1}
              className="min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
            />
            <button
              id="btn-enviar-chat"
              onClick={() => handleSend()}
              disabled={!inputText.trim() && !selectedImage}
              className="btn-primary p-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              title={loading ? 'Añadir consulta a la cola (Enter)' : 'Enviar mensaje (Enter)'}
            >
              {loading && !inputText.trim() && !selectedImage ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--color-text-subtle)]">
            Presione <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg-main)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">Enter</kbd> para enviar · <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg-main)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">Shift + Enter</kbd> para salto de línea
          </p>
        </div>
      </div>

      {/* Modal Visor Documento */}
      {docViewerUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 p-4" onClick={() => setDocViewerUrl(null)}>
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
              <h3 className="flex items-center gap-2 font-bold text-[var(--color-text)]">
                <FileText className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={1.75} />
                {docViewerTitle}
              </h3>
              <button onClick={() => setDocViewerUrl(null)} className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]">
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden bg-[var(--color-bg-main)]">
              {loadingDoc ? (
                <div className="flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent)]" strokeWidth={1.75} />
                  <span className="text-xs">Cargando documento protegido...</span>
                </div>
              ) : docBlobUrl ? (
                <iframe 
                  src={docBlobUrl} 
                  className="w-full h-full border-none" 
                  title="Visor" 
                />
              ) : (
                <div className="text-xs text-[var(--color-danger)]">No fue posible previsualizar el documento de forma segura.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
