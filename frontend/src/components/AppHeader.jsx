import React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BrainCircuit,
  Camera,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquare,
  Send,
  Shield,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import { BotonTourGuiado } from './TourGuiado';

const CONTEXTOS = [
  { prefijo: '/pqrs', etiqueta: 'Mesa de Ayuda PQRS', icono: LifeBuoy },
  { prefijo: '/radicar', etiqueta: 'Portal Ciudadano', icono: Send },
  { prefijo: '/vision', etiqueta: 'Captura Visión IA', icono: Camera },
  { prefijo: '/ingesta', etiqueta: 'Repositorios & Ingesta', icono: UploadCloud },
  { prefijo: '/chat', etiqueta: 'Copiloto RAG IA', icono: MessageSquare },
  { prefijo: '/dashboard', etiqueta: 'Gobierno & TI', icono: BarChart3 },
  { prefijo: '/login', etiqueta: 'Acceso Corporativo', icono: ShieldCheck },
];

function contextoDeRuta(pathname) {
  const coincidencias = CONTEXTOS.filter(
    ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`)
  ).sort((a, b) => b.prefijo.length - a.prefijo.length);
  return coincidencias[0] || { prefijo: '/', etiqueta: 'Consola Operativa', icono: LayoutDashboard };
}

function ModeSwitcher({ isAuthenticated, className = '' }) {
  const modos = [
    { to: '/radicar', label: 'Portal Ciudadano', icono: Send },
    { to: '/vision', label: 'Captura Visión', icono: Camera },
    isAuthenticated
      ? { to: '/pqrs', label: 'Consola Operativa', icono: LayoutDashboard }
      : { to: '/login', label: 'Acceso Funcionarios', icono: ShieldCheck },
  ];

  return (
    <nav
      aria-label="Cambio rápido de modo"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] p-0.5 ${className}`}
    >
      {modos.map(({ to, label, icono: Icono }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors active:scale-[0.98] ${
              isActive
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
            }`
          }
        >
          <Icono className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="whitespace-nowrap">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppHeader({ onOpenSidebar }) {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const contexto = contextoDeRuta(location.pathname);
  const IconoContexto = contexto.icono;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)] backdrop-blur-md">
      <div className="flex min-h-[56px] items-center gap-2 px-3 sm:px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Abrir navegación"
              title="Abrir navegación"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)] active:scale-[0.98] lg:hidden"
            >
              <Menu className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}

          <Link
            to={isAuthenticated ? '/pqrs' : '/radicar'}
            className="flex min-w-0 items-center gap-2 rounded-md"
            aria-label="DocuMind Enterprise OS"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <BrainCircuit className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold leading-none tracking-tight text-[var(--color-text)]">
                DocuMind
              </span>
              <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-subtle)] sm:block">
                Enterprise OS
              </span>
            </span>
          </Link>

          <span className="hidden h-4 w-px shrink-0 bg-[var(--color-border)] sm:block" />

          <span className="hidden min-w-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2 py-1 sm:inline-flex">
            <IconoContexto className="h-3 w-3 shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} />
            <span className="truncate text-[11px] font-semibold text-[var(--color-text-muted)]">
              {contexto.etiqueta}
            </span>
          </span>
        </div>

        <ModeSwitcher isAuthenticated={isAuthenticated} className="hidden md:inline-flex" />

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-muted)] xl:inline-flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Motor IA Activo
          </span>

          <ThemeToggle mostrarEtiqueta={false} />

          <BotonTourGuiado mostrarEtiqueta={false} />

          {isAuthenticated && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2.5 py-1.5 xl:flex">
              <Shield className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text)]">
                {user?.rol || 'N/A'}
              </span>
              {user?.departamento && (
                <>
                  <span className="text-[var(--color-text-subtle)]">·</span>
                  <span className="max-w-[140px] truncate text-[10px] font-medium text-[var(--color-text-muted)]">
                    {user.departamento}
                  </span>
                </>
              )}
            </div>
          )}

          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-t border-[var(--color-border)] px-3 py-1.5 md:hidden">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-main)] px-2 py-1 sm:hidden">
          <IconoContexto className="h-3 w-3 text-[var(--color-accent)]" strokeWidth={1.75} />
          <span className="max-w-[120px] truncate text-[10px] font-semibold text-[var(--color-text-muted)]">
            {contexto.etiqueta}
          </span>
        </span>
        <ModeSwitcher isAuthenticated={isAuthenticated} />
      </div>
    </header>
  );
}
