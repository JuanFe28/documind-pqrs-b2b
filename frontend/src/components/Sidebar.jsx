import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BrainCircuit,
  Camera,
  ChevronRight,
  FolderOpen,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquare,
  Plus,
  Send,
  Shield,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { repositoriesAPI } from '../services/api';

const SECCIONES_BASE = [
  {
    id: 'operacion',
    titulo: 'Operación PQRS',
    items: [
      { to: '/pqrs', icon: LifeBuoy, label: 'Mesa de Ayuda PQRS', descripcion: 'Gestión y SLA' },
      { to: '/radicar', icon: Send, label: 'Portal Ciudadano', descripcion: 'Radicación pública' },
      { to: '/vision', icon: Camera, label: 'Captura Visión IA', descripcion: 'Digitalización' },
    ],
  },
  {
    id: 'conocimiento',
    titulo: 'Conocimiento & Copiloto IA',
    items: [
      { to: '/chat', icon: MessageSquare, label: 'Copiloto RAG IA', descripcion: '3.er repositorio oficial' },
      { to: '/ingesta', icon: UploadCloud, label: 'Repositorios & Ingesta', descripcion: 'Documentos y vectores' },
    ],
  },
];

export default function Sidebar({ onRepoSelect, selectedRepo, mobileOpen = false, onMobileClose }) {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [repositorios, setRepositorios] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [showNewRepo, setShowNewRepo] = useState(false);
  const [newRepoNombre, setNewRepoNombre] = useState('');
  const [newRepoDept, setNewRepoDept] = useState('');
  const [creatingRepo, setCreatingRepo] = useState(false);

  const cargarRepositorios = async () => {
    try {
      setLoadingRepos(true);
      const res = await repositoriesAPI.list();
      const repos = res.data.repositorios || [];
      setRepositorios(repos);
      if (repos.length > 0 && onRepoSelect) {
        if (!selectedRepo || !repos.some((r) => r.id === selectedRepo.id)) {
          onRepoSelect(repos[0], { auto: true });
        }
      }
    } catch {
      // Error silencioso en sidebar
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    cargarRepositorios();
  }, [user?.id]);

  const handleLogout = () => {
    logout();
    if (onMobileClose) onMobileClose();
    navigate('/login');
  };

  const handleCreateRepo = async (e) => {
    e.preventDefault();
    if (!newRepoNombre.trim() || !newRepoDept.trim()) return;

    setCreatingRepo(true);
    try {
      const res = await repositoriesAPI.create({
        nombre: newRepoNombre.trim(),
        departamento: newRepoDept.trim(),
      });
      const nuevo = res.data?.repositorio;
      setNewRepoNombre('');
      setNewRepoDept('');
      setShowNewRepo(false);
      await cargarRepositorios();
      if (nuevo && onRepoSelect) {
        onRepoSelect(nuevo);
      }
    } catch {
      // Silencioso
    } finally {
      setCreatingRepo(false);
    }
  };

  const secciones = [
    ...SECCIONES_BASE,
    {
      id: 'gobierno',
      titulo: 'Gobierno & Auditoría',
      items: isAdmin
        ? [{ to: '/dashboard', icon: BarChart3, label: 'Dashboard & Logs', descripcion: 'Observabilidad' }]
        : [],
    },
  ];

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar navegación"
        onClick={onMobileClose}
        tabIndex={mobileOpen ? 0 : -1}
        className={`fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        id="sidebar-nav"
        className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[272px] max-w-[86vw] flex-shrink-0 flex-col border-r border-[var(--color-sidebar-border)] bg-[var(--color-sidebar)] transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:w-64 lg:max-w-none lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-sidebar-border)] px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <BrainCircuit className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-none tracking-tight text-[var(--color-sidebar-text)]">
                DocuMind
              </p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-sidebar-muted)]">
                Enterprise OS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Cerrar menú lateral"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-sidebar-muted)] transition-colors hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text)] lg:hidden"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {secciones.map((seccion) => (
            <div key={seccion.id}>
              <p className="sidebar-section-label mb-1.5">{seccion.titulo}</p>

              {seccion.items.map(({ to, icon: Icono, label, descripcion }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onMobileClose}
                  id={`nav-${label.replace(/\s+/g, '-').toLowerCase()}`}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                >
                  <Icono className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{label}</span>
                    <span className="block truncate text-[10px] font-normal opacity-70">
                      {descripcion}
                    </span>
                  </span>
                </NavLink>
              ))}

              {seccion.id === 'gobierno' && !isAdmin && (
                <div className="flex min-h-[38px] items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] text-[var(--color-sidebar-muted)]">
                  <LockKeyhole className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Auditoría restringida a ADMIN</span>
                </div>
              )}

              {seccion.id === 'conocimiento' && (
                <div className="mt-3 border-t border-[var(--color-sidebar-border)] pt-3">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-sidebar-muted)]">
                      Repositorios activos
                    </p>
                    <button
                      type="button"
                      id="btn-nuevo-repositorio"
                      onClick={() => setShowNewRepo(!showNewRepo)}
                      aria-expanded={showNewRepo}
                      aria-label="Crear repositorio"
                      title="Crear repositorio"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-sidebar-muted)] transition-colors hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text)] active:scale-[0.98]"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>

                  {showNewRepo && (
                    <form onSubmit={handleCreateRepo} className="mb-2 space-y-2 px-1 animate-fade-in">
                      <input
                        type="text"
                        placeholder="Nombre del repositorio"
                        value={newRepoNombre}
                        onChange={(e) => setNewRepoNombre(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-footer)] px-2.5 py-1.5 text-[11px] text-[var(--color-sidebar-text)] placeholder:text-[var(--color-sidebar-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Departamento"
                        value={newRepoDept}
                        onChange={(e) => setNewRepoDept(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-footer)] px-2.5 py-1.5 text-[11px] text-[var(--color-sidebar-text)] placeholder:text-[var(--color-sidebar-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={creatingRepo}
                        className="flex w-full items-center justify-center gap-1 rounded-lg bg-[var(--color-accent)] py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98] disabled:opacity-60"
                      >
                        {creatingRepo ? (
                          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                        ) : (
                          'Crear repositorio'
                        )}
                      </button>
                    </form>
                  )}

                  <div className="space-y-0.5">
                    {loadingRepos ? (
                      <div className="flex items-center gap-2 px-2 py-2">
                        <Loader2 className="h-3 w-3 animate-spin text-[var(--color-sidebar-muted)]" strokeWidth={1.75} />
                        <span className="text-[11px] text-[var(--color-sidebar-muted)]">Cargando...</span>
                      </div>
                    ) : repositorios.length === 0 ? (
                      <p className="px-2 py-2 text-[11px] text-[var(--color-sidebar-muted)]">
                        Sin repositorios aún.
                      </p>
                    ) : (
                      repositorios.map((repo) => {
                        const activo = selectedRepo?.id === repo.id;
                        return (
                          <button
                            key={repo.id}
                            type="button"
                            id={`repo-${repo.id}`}
                            onClick={() => {
                              onRepoSelect?.(activo ? null : repo);
                              onMobileClose?.();
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors active:scale-[0.98] ${
                              activo
                                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'text-[var(--color-sidebar-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text)]'
                            }`}
                          >
                            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium">{repo.nombre}</span>
                              <span className="block truncate text-[10px] opacity-70">{repo.departamento}</span>
                            </span>
                            {repo.total_documentos > 0 && (
                              <span className="rounded-full bg-[var(--color-sidebar-hover)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums">
                                {repo.total_documentos}
                              </span>
                            )}
                            {activo && <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.75} />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-footer)] px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[13px] font-bold text-white">
              {user?.nombre?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--color-sidebar-text)]">
                {user?.nombre || 'Usuario'}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Shield className="h-3 w-3 shrink-0 text-[var(--color-sidebar-muted)]" strokeWidth={1.75} />
                <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-wide text-[var(--color-sidebar-muted)]">
                  {user?.rol || 'N/A'}
                </span>
                {user?.departamento && (
                  <span className="hidden truncate text-[9px] text-[var(--color-sidebar-muted)] xl:inline">
                    · {user.departamento}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            id="btn-logout"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-sidebar-border)] py-1.5 text-[11px] font-semibold text-[var(--color-sidebar-muted)] transition-colors hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text)] active:scale-[0.98]"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
