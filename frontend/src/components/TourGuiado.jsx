import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  FileText,
  Gauge,
  Key,
  LayoutDashboard,
  Lock,
  Mail,
  MessageSquare,
  ShieldCheck,
  Star,
  Timer,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const TOUR_OPEN_EVENT = 'documind:abrir-tour';
export const PORTAL_TAB_EVENT = 'documind:portal-tab';

const PASOS = [
  {
    id: 'entrada',
    titulo: 'Entrada de Información',
    descripcion:
      'Desde el App Shell, el ciudadano radica con plantillas rápidas, request_id idempotente y adjuntos analizados por IA.',
    ruta: '/radicar',
    selector: '[data-tour="entrada-radicacion"]',
    puntos: [
      'Portal de Radicación con presets de casos frecuentes.',
      'request_id UUID para evitar duplicados en reintentos.',
      'Evidencias opcionales procesadas por el motor documental.',
    ],
  },
  {
    id: 'sla',
    titulo: 'Procesamiento y Cálculo de SLA',
    descripcion:
      'La política SLA normaliza prioridades y asigna plazos de 2h, 4h, 24h o 48h antes de persistir el caso.',
    ruta: '/pqrs',
    selector: '[data-tour="sla-dashboard"]',
    puntos: [
      'Prioridad Crítica: 2 horas. Alta: 4 horas.',
      'Media: 24 horas. Baja: 48 horas.',
      'Normalización y fecha límite visibles en cada radicado.',
    ],
  },
  {
    id: 'decision',
    titulo: 'Toma de Decisión y Acción Automática',
    descripcion:
      'El motor decide la bifurcación urgente, notifica por SMTP y entrega un tracking_token privado al ciudadano.',
    ruta: '/pqrs',
    selector: '[data-tour="decision-acciones"]',
    puntos: [
      'Bifurcación automática para casos urgentes y escalamiento.',
      'Notificación SMTP con resumen y enlace de seguimiento.',
      'tracking_token privado para consultar el expediente.',
    ],
  },
  {
    id: 'workspace',
    titulo: 'Almacenamiento PostgreSQL y Workspace RBAC',
    descripcion:
      'El Workspace Agente del App Shell consolida 5 KPIs, filtros por rol y concurrencia optimista con version.',
    ruta: '/pqrs',
    selector: '[data-tour="workspace-rbac"]',
    puntos: [
      'Persistencia transaccional en PostgreSQL.',
      'Cinco indicadores unificados y filtros según RBAC.',
      'Control de concurrencia con version en cada actualización.',
    ],
  },
  {
    id: 'seguimiento',
    titulo: 'Rastreo del Cliente, CSAT y Copiloto PQRS',
    descripcion:
      'El ciudadano consulta el timeline y califica la atención; el agente resuelve el caso desde el App Shell con el copiloto conectado al expediente.',
    ruta: '/radicar',
    selector: '[data-tour="tracking-cliente"]',
    puntos: [
      'Timeline público y expediente protegido por token.',
      'Encuesta CSAT de 1 a 5 estrellas con comentario.',
      'Botón "Consultar solución con IA" sobre Manuales, Normativa y Protocolos PQRS: hallazgo citado en menos de 1.5s.',
      'Borrador de respuesta listo para copiar y enviar al ciudadano.',
    ],
  },
];

function abrirTour() {
  window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT));
}

export function BotonTourGuiado({ className = '', mostrarEtiqueta = true }) {
  return (
    <button
      type="button"
      onClick={abrirTour}
      title="Abrir recorrido guiado"
      aria-label="Abrir recorrido guiado de 5 pasos"
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98] ${className}`}
    >
      <Compass className="h-4 w-4 text-[#2563EB]" strokeWidth={1.75} />
      {mostrarEtiqueta ? (
        <span>Recorrido Guiado</span>
      ) : (
        <span className="sr-only">Recorrido Guiado</span>
      )}
    </button>
  );
}

function VistaPreviaPaso({ paso }) {
  if (paso === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-3">
        <div className="flex flex-wrap gap-1.5">
          {['Conectividad', 'Facturación', 'Garantía', 'Queja'].map((preset) => (
            <span
              key={preset}
              className="rounded-md border border-[#2563EB]/20 bg-[#2563EB]/10 px-2 py-1 text-[10px] font-semibold text-[#2563EB]"
            >
              {preset}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-[10px] text-[var(--color-text-muted)]">
          <Key className="h-3.5 w-3.5 text-[#2563EB]" strokeWidth={1.75} />
          <span className="font-mono text-[var(--color-text)]">request_id</span>
          <span className="truncate font-mono">7f3c...-a1b2</span>
        </div>
      </div>
    );
  }

  if (paso === 1) {
    return (
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-3">
        {[
          ['Crítica', '2h', 'bg-rose-50 text-rose-700 border-rose-200'],
          ['Alta', '4h', 'bg-orange-50 text-orange-700 border-orange-200'],
          ['Media', '24h', 'bg-sky-50 text-sky-700 border-sky-200'],
          ['Baja', '48h', 'bg-slate-100 text-slate-600 border-slate-200'],
        ].map(([nombre, plazo, clases]) => (
          <span
            key={nombre}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${clases}`}
          >
            {nombre}
            <span className="font-mono tabular-nums">{plazo}</span>
          </span>
        ))}
      </div>
    );
  }

  if (paso === 2) {
    return (
      <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-3 text-[10px]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#2563EB]">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
            Bifurcación urgente
          </span>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
            Prioridad Crítica
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--color-text-muted)]">
            <Mail className="h-3 w-3 text-[#2563EB]" strokeWidth={1.75} />
            SMTP enviado
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[var(--color-text-muted)]">
            <Key className="h-3 w-3 text-[#2563EB]" strokeWidth={1.75} />
            token ****
          </span>
        </div>
      </div>
    );
  }

  if (paso === 3) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-3">
        <div className="grid grid-cols-5 divide-x divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          {[
            ['Total', '128'],
            ['Críticos', '6'],
            ['Activos', '41'],
            ['SLA', '96.4%'],
            ['CSAT', '4.6'],
          ].map(([etiqueta, valor]) => (
            <div key={etiqueta} className="px-1.5 py-2 text-center">
              <p className="truncate text-[8px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                {etiqueta}
              </p>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums text-[var(--color-text)]">
                {valor}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[9px] text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1">
            <LayoutDashboard className="h-3 w-3" strokeWidth={1.75} />
            Workspace Agente
          </span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Lock className="h-3 w-3" strokeWidth={1.75} />
            version 3
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-main)] p-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text)]">
          <FileText className="h-3.5 w-3.5 text-[#2563EB]" strokeWidth={1.75} />
          Timeline del radicado
        </span>
        <span className="inline-flex gap-0.5 text-amber-500" aria-label="CSAT 5 de 5">
          {[1, 2, 3, 4, 5].map((valor) => (
            <Star key={valor} className="h-3 w-3" strokeWidth={1.75} fill="currentColor" />
          ))}
        </span>
      </div>
      <div className="space-y-1.5 border-l border-[var(--color-border)] pl-2.5 text-[9px] text-[var(--color-text-muted)]">
        <p className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
          Radicado recibido
        </p>
        <p className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Resuelto y notificado por SMTP
        </p>
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[9px] text-[var(--color-text-muted)]">
        <MessageSquare className="h-3 w-3 text-[#2563EB]" strokeWidth={1.75} />
        Copiloto PQRS con borrador citado
        <span className="ml-auto inline-flex items-center gap-1 font-mono tabular-nums">
          <Timer className="h-2.5 w-2.5" strokeWidth={1.75} />
          842 ms
        </span>
      </div>
    </div>
  );
}

export default function TourGuiado() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState(0);
  const [spot, setSpot] = useState(null);
  const tarjetaRef = useRef(null);
  const focoAnteriorRef = useRef(null);
  const scrollAnteriorRef = useRef(null);

  const pasoActual = PASOS[paso];
  const esUltimo = paso === PASOS.length - 1;

  const cerrar = useCallback(() => {
    setAbierto(false);
    setPaso(0);
    setSpot(null);
  }, []);

  const anterior = useCallback(() => {
    setPaso((actual) => Math.max(0, actual - 1));
  }, []);

  const siguiente = useCallback(() => {
    setPaso((actual) => Math.min(PASOS.length - 1, actual + 1));
  }, []);

  useEffect(() => {
    const abrir = () => {
      focoAnteriorRef.current = document.activeElement;
      scrollAnteriorRef.current = { x: window.scrollX, y: window.scrollY };
      setPaso(0);
      setAbierto(true);
    };
    window.addEventListener(TOUR_OPEN_EVENT, abrir);
    return () => window.removeEventListener(TOUR_OPEN_EVENT, abrir);
  }, []);

  useEffect(() => {
    if (!abierto) {
      const anteriorFoco = focoAnteriorRef.current;
      if (anteriorFoco && typeof anteriorFoco.focus === 'function') {
        anteriorFoco.focus({ preventScroll: true });
      }
      const scroll = scrollAnteriorRef.current;
      if (scroll) window.scrollTo(scroll.x, scroll.y);
      scrollAnteriorRef.current = null;
      return;
    }

    const focoTimer = window.setTimeout(() => tarjetaRef.current?.focus(), 60);
    return () => window.clearTimeout(focoTimer);
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;

    if (isAuthenticated) {
      if (location.pathname !== pasoActual.ruta) {
        navigate(pasoActual.ruta);
      }
      if (pasoActual.ruta === '/radicar') {
        window.dispatchEvent(
          new CustomEvent(PORTAL_TAB_EVENT, {
            detail: pasoActual.id === 'seguimiento' ? 'tracking' : 'radicar',
          })
        );
      }
    }
  }, [abierto, isAuthenticated, location.pathname, navigate, pasoActual]);

  useEffect(() => {
    if (!abierto) return undefined;

    let cancelado = false;
    let intentos = 0;
    let temporizador = null;

    const actualizarRect = () => {
      if (cancelado) return;
      const selector = pasoActual.selector;
      if (!selector) {
        setSpot(null);
        return;
      }
      const elemento = document.querySelector(selector);
      if (!elemento) {
        setSpot(null);
        return;
      }
      const rect = elemento.getBoundingClientRect();
      setSpot({
        top: Math.max(0, rect.top),
        left: Math.max(0, rect.left),
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      });
    };

    const medir = () => {
      if (cancelado) return;
      const elemento = pasoActual.selector ? document.querySelector(pasoActual.selector) : null;
      if (elemento) {
        elemento.scrollIntoView({ behavior: 'smooth', block: 'center' });
        actualizarRect();
        return;
      }
      if (intentos < 24) {
        intentos += 1;
        temporizador = window.setTimeout(medir, 180);
        return;
      }
      setSpot(null);
    };

    const inicio = window.setTimeout(medir, 120);
    window.addEventListener('resize', actualizarRect);
    window.addEventListener('scroll', actualizarRect, true);

    return () => {
      cancelado = true;
      window.clearTimeout(inicio);
      if (temporizador) window.clearTimeout(temporizador);
      window.removeEventListener('resize', actualizarRect);
      window.removeEventListener('scroll', actualizarRect, true);
    };
  }, [abierto, pasoActual]);

  useEffect(() => {
    if (!abierto) return undefined;

    const onKeyDown = (evento) => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        cerrar();
        return;
      }
      if (evento.key === 'ArrowRight') {
        evento.preventDefault();
        siguiente();
        return;
      }
      if (evento.key === 'ArrowLeft') {
        evento.preventDefault();
        anterior();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto, anterior, cerrar, siguiente]);

  if (!abierto) return null;

  const ancho = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const tarjetaIzquierda = spot && ancho >= 1024 && spot.left + spot.width / 2 > ancho / 2;

  return (
    <div className="text-[var(--color-text)]">
      {spot ? (
        <>
          <div
            className="fixed left-0 right-0 top-0 z-[95] bg-slate-950/45 backdrop-blur-[3px]"
            style={{ height: spot.top }}
            aria-hidden="true"
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[95] bg-slate-950/45 backdrop-blur-[3px]"
            style={{ top: spot.top + spot.height }}
            aria-hidden="true"
          />
          <div
            className="fixed left-0 z-[95] bg-slate-950/45 backdrop-blur-[3px]"
            style={{ top: spot.top, height: spot.height, width: spot.left }}
            aria-hidden="true"
          />
          <div
            className="fixed right-0 z-[95] bg-slate-950/45 backdrop-blur-[3px]"
            style={{
              top: spot.top,
              height: spot.height,
              left: spot.left + spot.width,
            }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none fixed z-[96] rounded-xl ring-2 ring-[#2563EB] transition-all duration-300"
            style={{
              top: spot.top - 4,
              left: spot.left - 4,
              width: spot.width + 8,
              height: spot.height + 8,
              boxShadow: '0 0 0 5px rgba(37, 99, 235, 0.22)',
            }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div
          className="fixed inset-0 z-[95] bg-slate-950/45 backdrop-blur-[3px]"
          aria-hidden="true"
        />
      )}

      <div
        ref={tarjetaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-titulo"
        aria-describedby="tour-descripcion"
        tabIndex={-1}
        className={`animate-tour-in fixed bottom-4 left-4 right-4 z-[100] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl outline-none sm:bottom-6 sm:right-6 sm:left-auto sm:w-[420px] ${
          tarjetaIzquierda ? 'sm:left-6 sm:right-auto' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]">
              <Compass className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#2563EB]">
                Recorrido Guiado
              </p>
              <p className="text-[11px] font-medium tabular-nums text-[var(--color-text-muted)]" aria-live="polite">
                Paso {paso + 1} de {PASOS.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar recorrido guiado"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--color-bg-main)]">
          <div
            className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
            style={{ width: `${((paso + 1) / PASOS.length) * 100}%` }}
          />
        </div>

        <h3 id="tour-titulo" className="mt-4 text-base font-semibold tracking-tight text-[var(--color-text)]">
          {pasoActual.titulo}
        </h3>
        <p id="tour-descripcion" className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {pasoActual.descripcion}
        </p>

        <ul className="mt-3 space-y-1.5">
          {pasoActual.puntos.map((punto) => (
            <li key={punto} className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2563EB]" strokeWidth={1.75} />
              <span>{punto}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <VistaPreviaPaso paso={paso} />
        </div>

        {!isAuthenticated ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-[#2563EB]/5 px-2.5 py-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            <Gauge className="mt-0.5 h-3 w-3 shrink-0 text-[#2563EB]" strokeWidth={1.75} />
            Vista previa interactiva. Inicia sesión para recorrer las rutas reales del sistema sin llamadas protegidas.
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
          <button
            type="button"
            onClick={anterior}
            disabled={paso === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Anterior
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={siguiente}
              disabled={esUltimo}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-600"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              Finalizar
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-[10px] text-[var(--color-text-subtle)]">
          Atajos: flecha derecha siguiente · flecha izquierda anterior · Escape finalizar
        </p>
      </div>
    </div>
  );
}
