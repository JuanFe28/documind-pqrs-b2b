import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Camera,
  ChevronDown,
  Eye,
  EyeOff,
  Gauge,
  Headphones,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Receipt,
  Scale,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const DEMO_USERS = [
  {
    id: 'admin',
    etiqueta: 'Admin Global',
    detalle: 'Administrador DocuMind',
    email: 'admin@documind.com',
    password: 'Admin2026*!',
    icono: ShieldCheck,
  },
  {
    id: 'supervisor',
    etiqueta: 'Supervisor Soporte · Andrea Silva',
    detalle: 'andrea.silva@techflow.co',
    email: 'andrea.silva@techflow.co',
    password: 'SupervisorSoporte2026*',
    icono: Headphones,
  },
  {
    id: 'facturacion',
    etiqueta: 'Agente Facturación · Carlos Restrepo',
    detalle: 'carlos.restrepo@techflow.co',
    email: 'carlos.restrepo@techflow.co',
    password: 'AgenteFacturacion2026*',
    icono: Receipt,
  },
  {
    id: 'calidad',
    etiqueta: 'Agente Calidad · Valeria Gómez',
    detalle: 'valeria.gomez@techflow.co',
    email: 'valeria.gomez@techflow.co',
    password: 'AgenteCalidad2026*',
    icono: BadgeCheck,
  },
  {
    id: 'legal',
    etiqueta: 'Auditoría Legal · Diana Rodríguez',
    detalle: 'diana.legal@documind.com',
    email: 'diana.legal@documind.com',
    password: 'Legal2026*!',
    icono: Scale,
  },
];

const PILARES = [
  {
    icono: Camera,
    titulo: 'Captura Omnicanal',
    descripcion: 'Formularios físicos, correo y cargas digitales normalizados por visión artificial.',
  },
  {
    icono: Gauge,
    titulo: 'Motor Transaccional PQRS & SLAs',
    descripcion: 'Radicación idempotente, trazabilidad por rol y cumplimiento de plazos en tiempo real.',
  },
  {
    icono: MessageSquare,
    titulo: 'Copiloto RAG con 3.er Repositorio Oficial',
    descripcion: 'Respuestas citadas sobre el repositorio corporativo, el departamental y el de conocimiento.',
  },
];

function destinoPorRol(rol) {
  const normalizado = (rol || '').toUpperCase();
  if (normalizado === 'ADMIN') return '/dashboard';
  if (normalizado === 'SUPERVISOR' || normalizado === 'AGENTE') return '/pqrs';
  if (['LEGAL', 'FINANCIERO', 'RECLUTADOR'].includes(normalizado)) return '/ingesta';
  return '/pqrs';
}

function EstadoApi({ estado }) {
  const etiquetas = {
    verificando: 'Verificando API',
    online: 'API Operativa',
    offline: 'API sin conexión',
  };
  const tonos = {
    verificando: 'bg-amber-500',
    online: 'bg-emerald-500',
    offline: 'bg-rose-500',
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${tonos[estado]}`} />
      <Server className="h-3 w-3" strokeWidth={1.75} />
      {etiquetas[estado]}
    </span>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [mostrarDemo, setMostrarDemo] = useState(false);
  const [estadoApi, setEstadoApi] = useState('verificando');

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    api
      .get('/health', { timeout: 5000, signal: controlador.signal })
      .then(() => {
        if (activo) setEstadoApi('online');
      })
      .catch(() => {
        if (activo) setEstadoApi('offline');
      });

    return () => {
      activo = false;
      controlador.abort();
    };
  }, []);

  useEffect(() => {
    if (retrySeconds <= 0) return undefined;
    const temporizador = window.setTimeout(() => {
      setRetrySeconds((actual) => Math.max(0, actual - 1));
    }, 1000);
    return () => window.clearTimeout(temporizador);
  }, [retrySeconds]);

  const validar = () => {
    const errores = {};
    const correo = email.trim();

    if (!correo) {
      errores.email = 'Ingresa tu correo corporativo.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      errores.email = 'El formato del correo no es válido.';
    }

    if (!password) {
      errores.password = 'Ingresa tu contraseña.';
    }

    setFieldErrors(errores);
    return Object.keys(errores).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (retrySeconds > 0) return;
    if (!validar()) return;

    setLoading(true);
    try {
      const usuario = await login(email.trim(), password);
      navigate(destinoPorRol(usuario?.rol), { replace: true });
    } catch (err) {
      if (err.response?.status === 429) {
        const segundos = Number(err.response?.data?.reintentar_en_segundos) || 900;
        setRetrySeconds(Math.max(1, segundos));
        setError(
          err.response?.data?.mensaje ||
            'Demasiados intentos fallidos. Espera antes de volver a intentarlo.'
        );
      } else {
        setError(
          err.response?.data?.mensaje ||
            'No fue posible autenticar. Verifica tus credenciales o la conexión con el servidor.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const aplicarDemo = (demo) => {
    setEmail(demo.email);
    setPassword(demo.password);
    setFieldErrors({});
    setError('');
  };

  const deshabilitado = loading || retrySeconds > 0;

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-1 bg-[var(--color-bg-main)] text-[var(--color-text)]">
      <div className="mx-auto grid w-full max-w-[1440px] flex-1 lg:grid-cols-[minmax(0,1fr)_460px] xl:grid-cols-[minmax(0,1fr)_500px]">
        <section className="hidden flex-col justify-between border-r border-[var(--color-border)] px-10 py-12 lg:flex xl:px-16 xl:py-16">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              Plataforma corporativa
            </p>

            <h1 className="mt-6 text-[34px] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--color-text)] xl:text-[42px]">
              DocuMind
              <span className="block text-[var(--color-text-muted)]">Enterprise OS</span>
            </h1>

            <p className="mt-5 max-w-lg text-[14px] leading-relaxed text-[var(--color-text-muted)]">
              Una sola consola para capturar, resolver y auditar cada interacción documental de la
              organización con trazabilidad completa.
            </p>

            <ul className="mt-10 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {PILARES.map(({ icono: Icono, titulo, descripcion }) => (
                <li key={titulo} className="flex gap-4 py-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                    <Icono className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--color-text)]">{titulo}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                      {descripcion}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-6">
            <EstadoApi estado={estadoApi} />
            <Link
              to="/radicar"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-main)] active:scale-[0.98]"
            >
              Portal Ciudadano
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </div>
        </section>

        <section
          className="flex min-w-0 flex-col justify-center px-4 py-8 sm:px-8 lg:px-10 lg:py-12"
          data-tour="login-acceso"
        >
          <div className="mx-auto w-full max-w-[420px]">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:hidden">
              <EstadoApi estado={estadoApi} />
              <Link
                to="/radicar"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-accent)]"
              >
                Portal Ciudadano
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Link>
            </div>

            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                <ShieldCheck className="h-3 w-3 text-[var(--color-accent)]" strokeWidth={1.75} />
                Acceso corporativo
              </p>
              <h2 className="mt-4 text-[26px] font-bold tracking-[-0.02em] text-[var(--color-text)]">
                Iniciar sesión
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
                Autentícate con tu cuenta corporativa para acceder a la consola operativa.
              </p>
            </div>

            <form id="form-login" onSubmit={handleSubmit} noValidate className="mt-7 space-y-5">
              <div>
                <label
                  htmlFor="input-email"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  Correo corporativo
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-subtle)]"
                    strokeWidth={1.75}
                  />
                  <input
                    id="input-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
                    }}
                    placeholder="usuario@documind.com"
                    required
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'error-email' : undefined}
                    className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 text-[13px] text-[var(--color-text)] input-corp outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                  />
                </div>
                {fieldErrors.email && (
                  <p id="error-email" className="mt-1.5 text-[11px] font-medium text-rose-600">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="input-password"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-subtle)]"
                    strokeWidth={1.75}
                  />
                  <input
                    id="input-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: '' }));
                      }
                    }}
                    placeholder="Contraseña corporativa"
                    required
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'error-password' : undefined}
                    className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-11 text-[13px] text-[var(--color-text)] input-corp outline-none transition-colors placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((actual) => !actual)}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="error-password" className="mt-1.5 text-[11px] font-medium text-rose-600">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium leading-relaxed">{error}</p>
                    {retrySeconds > 0 && (
                      <p className="mt-1 font-mono text-[11px] tabular-nums">
                        Reintento disponible en {retrySeconds}s
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                id="btn-login-submit"
                type="submit"
                disabled={deshabilitado}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    Autenticando...
                  </>
                ) : retrySeconds > 0 ? (
                  `Disponible en ${retrySeconds}s`
                ) : (
                  'Iniciar Sesión'
                )}
              </button>
            </form>

            <div className="mt-6 border-t border-[var(--color-border)] pt-5">
              <button
                type="button"
                onClick={() => setMostrarDemo((actual) => !actual)}
                aria-expanded={mostrarDemo}
                aria-controls="demo-credenciales"
                className="flex w-full items-center justify-between gap-3 rounded-md py-1 text-left active:scale-[0.99]"
              >
                <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-[var(--color-text-muted)]">
                  <KeyRound className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.75} />
                  Credenciales de Demostración · 1-Clic
                </span>
                <ChevronDown
                  className={`h-4 w-4 flex-shrink-0 text-[var(--color-text-muted)] transition-transform ${
                    mostrarDemo ? 'rotate-180' : ''
                  }`}
                  strokeWidth={1.75}
                />
              </button>

              {mostrarDemo && (
                <div
                  id="demo-credenciales"
                  className="mt-3 divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  {DEMO_USERS.map((demo) => {
                    const Icono = demo.icono;
                    return (
                      <button
                        key={demo.id}
                        type="button"
                        onClick={() => aplicarDemo(demo)}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-bg-main)] active:scale-[0.99]"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                          <Icono className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold text-[var(--color-text)]">
                            {demo.etiqueta}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                            {demo.detalle}
                          </span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-subtle)]" strokeWidth={1.75} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-[10px] leading-relaxed text-[var(--color-text-subtle)]">
              DocuMind Enterprise OS · Acceso restringido a personal autorizado
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
