import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileStack,
  FileText,
  Gauge,
  Inbox,
  LifeBuoy,
  LogOut,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { pqrsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  csvCell,
  estadoSla,
  formatActorTipo,
  formatConfianzaPct,
  formatEstadoLabel,
  formatFechaHora,
  formatPrioridadLabel,
  formatPrioridadValue,
  normalizarClave,
} from '../utils/pqrs';

const ESTADO_STYLES = {
  NUEVO: 'bg-sky-50 text-sky-700',
  ASIGNADO: 'bg-indigo-50 text-indigo-700',
  EN_GESTION: 'bg-amber-50 text-amber-700',
  ESPERANDO_CLIENTE: 'bg-violet-50 text-violet-700',
  RESUELTO: 'bg-emerald-50 text-emerald-700',
  CERRADO: 'bg-slate-100 text-slate-600',
};

const PRIORIDAD_STYLES = {
  CRITICA: 'bg-rose-50 text-rose-700',
  ALTA: 'bg-orange-50 text-orange-700',
  MEDIA: 'bg-sky-50 text-sky-700',
  BAJA: 'bg-slate-100 text-slate-600',
};

const SLA_TONES = {
  ok: 'text-emerald-600',
  warning: 'text-amber-600',
  late: 'text-rose-600',
  neutral: 'text-slate-400',
};

const KPI_TONES = {
  indigo: 'bg-indigo-50 text-indigo-700',
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  slate: 'bg-slate-100 text-slate-600',
};

const ESTADOS_FILTRO = [
  'NUEVO',
  'ASIGNADO',
  'EN_GESTION',
  'ESPERANDO_CLIENTE',
  'RESUELTO',
  'CERRADO',
];

const PRIORIDADES_FILTRO = ['Crítica', 'Alta', 'Media', 'Baja'];

function KpiCell({ etiqueta, valor, sufijo, pildora, icono: Icono, tono }) {
  return (
    <div className="p-5">
      <p className="text-[12px] font-medium tracking-wide text-slate-500">{etiqueta}</p>
      <p className="mt-2 flex items-baseline gap-1 text-[30px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
        {valor}
        {sufijo ? <span className="text-base font-medium text-slate-400">{sufijo}</span> : null}
      </p>
      <span
        className={`mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${KPI_TONES[tono]}`}
      >
        <Icono className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{pildora}</span>
      </span>
    </div>
  );
}

function BotonCopiar({ ticketId, copiado, onCopiar, compacto = false }) {
  return (
    <button
      type="button"
      onClick={() => onCopiar(ticketId)}
      aria-label={`Copiar radicado ${ticketId}`}
      title={copiado ? 'Copiado' : 'Copiar radicado'}
      className={`inline-flex items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-[0.96] ${
        compacto ? 'h-6 w-6' : 'h-7 w-7'
      }`}
    >
      {copiado ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

export default function GestionPqrs() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [tickets, setTickets] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [departamentos, setDepartamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [copiado, setCopiado] = useState(null);

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetalle, setTicketDetalle] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [versionActual, setVersionActual] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroPrioridad, setFiltroPrioridad] = useState('');
  const [filtroDepto, setFiltroDepto] = useState('');

  const [nuevoEstado, setNuevoEstado] = useState('');
  const [nota, setNota] = useState('');
  const [esNotaInterna, setEsNotaInterna] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true);
      const [ticketsRes, kpisRes] = await Promise.all([
        pqrsAPI.list({
          search: search || undefined,
          estado: filtroEstado || undefined,
          prioridad: filtroPrioridad || undefined,
          departamento: filtroDepto || undefined,
        }),
        pqrsAPI.getKpis(),
      ]);

      setTickets(ticketsRes.data.data || []);
      const resumen = kpisRes.data.data?.resumen || null;
      setKpis(resumen);
      setDepartamentos(
        (kpisRes.data.data?.distribucion_departamento || [])
          .map((item) => item.departamento)
          .filter(Boolean)
      );
    } catch (err) {
      console.error('Error al cargar PQRS:', err);
    } finally {
      setLoading(false);
    }
  }, [search, filtroEstado, filtroPrioridad, filtroDepto]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const departamentosDisponibles = useMemo(() => {
    const conjunto = new Set([
      ...departamentos,
      ...tickets.map((ticket) => ticket.departamento).filter(Boolean),
    ]);
    return Array.from(conjunto).sort((a, b) => a.localeCompare(b, 'es'));
  }, [departamentos, tickets]);

  const copiarTicket = useCallback(async (ticketId) => {
    if (!ticketId) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(ticketId);
      } else {
        const area = document.createElement('textarea');
        area.value = ticketId;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopiado(ticketId);
      setTimeout(() => setCopiado((actual) => (actual === ticketId ? null : actual)), 2000);
    } catch {
      setCopiado(null);
    }
  }, []);

  const refrescarDetalle = useCallback(async (ticketId) => {
    const res = await pqrsAPI.getById(ticketId);
    const detalle = res.data.data;
    setTicketDetalle(detalle);
    setVersionActual(detalle?.ticket?.version || 1);
    return detalle;
  }, []);

  const abrirDetalle = async (ticket) => {
    setSelectedTicket(ticket);
    setNuevoEstado(ticket.estado);
    setNota('');
    setEsNotaInterna(false);
    setFormError('');
    setFormNotice('');
    setVersionActual(ticket.version || 1);
    setTicketDetalle(null);

    try {
      setLoadingDetalle(true);
      await refrescarDetalle(ticket.ticket_id);
    } catch (err) {
      console.error('Error al cargar detalle:', err);
      setFormError('No fue posible cargar el expediente completo del ticket.');
    } finally {
      setLoadingDetalle(false);
    }
  };

  const cerrarDetalle = () => {
    setSelectedTicket(null);
    setTicketDetalle(null);
    setFormError('');
    setFormNotice('');
  };

  const handleActualizarEstado = async (evento) => {
    evento.preventDefault();
    if (!selectedTicket || !nuevoEstado || actualizando) return;

    setActualizando(true);
    setFormError('');
    setFormNotice('');

    try {
      await pqrsAPI.updateStatus(selectedTicket.ticket_id, {
        nuevo_estado: nuevoEstado,
        nota:
          nota.trim() ||
          (esNotaInterna
            ? 'Nota interna registrada por el agente.'
            : 'Respuesta pública registrada por el agente.'),
        es_nota_interna: esNotaInterna,
        version: versionActual,
      });

      await refrescarDetalle(selectedTicket.ticket_id);
      setNota('');
      setFormNotice('El cambio se aplicó y quedó registrado en la trazabilidad.');
      await cargarDatos();
    } catch (err) {
      if (err.response?.status === 409) {
        setFormError(
          'El ticket cambió mientras lo editabas. Actualizamos el expediente: revisa el estado más reciente antes de guardar de nuevo.'
        );
        try {
          await refrescarDetalle(selectedTicket.ticket_id);
          await cargarDatos();
        } catch {
          // La recarga se reintenta en la siguiente interacción.
        }
      } else {
        setFormError(
          err.response?.data?.mensaje || 'No fue posible actualizar el estado del ticket.'
        );
      }
    } finally {
      setActualizando(false);
    }
  };

  const descargarCsv = (filas) => {
    const encabezados = [
      'Radicado',
      'Solicitante',
      'Correo',
      'Tipo',
      'Prioridad',
      'Estado',
      'Departamento',
      'SLA horas',
      'Fecha límite SLA',
      'Documentos',
      'Fecha de radicación',
    ];

    const lineas = [encabezados.map(csvCell).join(',')];
    filas.forEach((ticket) => {
      lineas.push(
        [
          ticket.ticket_id,
          ticket.nombre,
          ticket.email,
          ticket.tipo,
          formatPrioridadLabel(ticket.prioridad),
          formatEstadoLabel(ticket.estado),
          ticket.departamento,
          ticket.sla_horas,
          ticket.sla_fecha_limite,
          ticket.total_documentos,
          ticket.created_at,
        ]
          .map(csvCell)
          .join(',')
      );
    });

    const blob = new Blob([`\uFEFF${lineas.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `pqrs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  };

  const handleExportar = async () => {
    if (exportando) return;
    setExportando(true);
    try {
      const res = await pqrsAPI.list({
        search: search || undefined,
        estado: filtroEstado || undefined,
        prioridad: filtroPrioridad || undefined,
        departamento: filtroDepto || undefined,
        limit: 500,
      });
      const filas = res.data.data?.length ? res.data.data : tickets;
      descargarCsv(filas);
    } catch {
      descargarCsv(tickets);
    } finally {
      setExportando(false);
    }
  };

  const consultarSolucionIA = () => {
    if (!selectedTicket) return;
    const consulta = `Analiza la solicitud ${selectedTicket.ticket_id} (${selectedTicket.tipo || 'PQRS'} · ${selectedTicket.departamento}). Asunto: "${selectedTicket.asunto}". Detalle: "${selectedTicket.descripcion || 'sin descripción adicional'}". Describe el diagnóstico operativo, las políticas aplicables y la respuesta recomendada para el cliente.`;
    navigate(
      `/chat?ticket_id=${encodeURIComponent(selectedTicket.ticket_id)}&repo=normativa&q=${encodeURIComponent(consulta)}`
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const total = Number(kpis?.total_tickets ?? 0);
  const criticos = Number(kpis?.criticos_pendientes ?? 0);
  const activos = Number(kpis?.tickets_abiertos ?? 0);
  const vencidos = Number(kpis?.vencidos_sla ?? 0);
  const slaPct = total > 0 ? Math.max(0, Math.min(100, ((total - vencidos) / total) * 100)) : 100;
  const csatRaw = kpis?.satisfaccion_promedio ?? kpis?.csat_promedio ?? null;
  const csatValor = csatRaw !== null && csatRaw !== undefined ? Number(csatRaw).toFixed(1) : '—';

  const filtrosActivos = Boolean(filtroEstado || filtroPrioridad || filtroDepto || search);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
              <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Mesa de Ayuda PQRS
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-500">
            Gestión unificada de solicitudes con trazabilidad documental, SLA y soporte de IA.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={cargarDatos}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.98]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              strokeWidth={1.75}
            />
            Actualizar
          </button>
          <button
            type="button"
            onClick={handleExportar}
            disabled={exportando}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            {exportando ? 'Exportando' : 'Exportar CSV'}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
            title={user?.nombre ? `Cerrar sesión de ${user.nombre}` : 'Cerrar sesión'}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </div>
      </header>

      <section
        aria-label="Indicadores de la mesa de ayuda"
        data-tour="sla-dashboard"
        className="mt-6 overflow-hidden rounded-2xl border border-slate-900/[0.06] bg-white shadow-sm"
      >
        <div className="grid grid-cols-1 divide-y divide-slate-900/[0.06] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5 xl:divide-x">
          <KpiCell
            etiqueta="Total Solicitudes"
            valor={total}
            pildora={`${tickets.length} visibles`}
            icono={Inbox}
            tono="indigo"
          />
          <KpiCell
            etiqueta="Críticos / Urgentes"
            valor={criticos}
            pildora={criticos > 0 ? 'Requieren atención' : 'Sin pendientes'}
            icono={AlertTriangle}
            tono="rose"
          />
          <KpiCell
            etiqueta="En Gestión / Activos"
            valor={activos}
            pildora="En operación"
            icono={Clock}
            tono="amber"
          />
          <KpiCell
            etiqueta="Cumplimiento SLA"
            valor={slaPct.toFixed(1)}
            sufijo="%"
            pildora={vencidos > 0 ? `${vencidos} vencidos` : 'Dentro del plazo'}
            icono={Gauge}
            tono={vencidos > 0 ? 'rose' : 'emerald'}
          />
          <KpiCell
            etiqueta="Satisfacción CSAT"
            valor={csatValor}
            sufijo={csatRaw !== null && csatRaw !== undefined ? '/ 5' : undefined}
            pildora={csatRaw !== null && csatRaw !== undefined ? 'Promedio general' : 'Sin encuestas'}
            icono={Star}
            tono="slate"
          />
        </div>
      </section>

      <section
        aria-label="Filtros del workspace"
        data-tour="workspace-rbac"
        className="mt-6 rounded-2xl border border-slate-900/[0.06] bg-white p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por radicado, solicitante o asunto"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={filtroEstado}
              onChange={(event) => setFiltroEstado(event.target.value)}
              aria-label="Filtrar por estado"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Todos los estados</option>
              {ESTADOS_FILTRO.map((estado) => (
                <option key={estado} value={estado}>
                  {formatEstadoLabel(estado)}
                </option>
              ))}
            </select>

            <select
              value={filtroPrioridad}
              onChange={(event) => setFiltroPrioridad(event.target.value)}
              aria-label="Filtrar por prioridad"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Todas las prioridades</option>
              {PRIORIDADES_FILTRO.map((prioridad) => (
                <option key={prioridad} value={formatPrioridadValue(prioridad)}>
                  {formatPrioridadLabel(prioridad)}
                </option>
              ))}
            </select>

            <select
              value={filtroDepto}
              onChange={(event) => setFiltroDepto(event.target.value)}
              aria-label="Filtrar por departamento"
              className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Todos los departamentos</option>
              {departamentosDisponibles.map((departamento) => (
                <option key={departamento} value={departamento}>
                  {departamento}
                </option>
              ))}
            </select>
          </div>

          {filtrosActivos && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setFiltroEstado('');
                setFiltroPrioridad('');
                setFiltroDepto('');
              }}
              className="h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 active:scale-[0.98]"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </section>

      <section
        aria-label="Listado de solicitudes"
        data-tour="decision-acciones"
        className="mt-6 overflow-hidden rounded-2xl border border-slate-900/[0.06] bg-white shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-900/[0.06] bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <th className="px-4 py-3">Radicado</th>
                <th className="px-4 py-3">Solicitante</th>
                <th className="px-4 py-3">Asunto / Tipo</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3">Documentos</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/[0.06] text-[13px]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    Cargando solicitudes...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <FileText className="mx-auto h-7 w-7 text-slate-300" strokeWidth={1.75} />
                    <p className="mt-2 text-slate-500">No se encontraron solicitudes con los filtros aplicados.</p>
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => {
                  const sla = estadoSla(ticket);
                  const prioridadKey = normalizarClave(ticket.prioridad);
                  const estadoKey = normalizarClave(ticket.estado);
                  return (
                    <tr
                      key={ticket.id ?? ticket.ticket_id}
                      className="h-[52px] min-h-[52px] transition-colors hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="whitespace-nowrap font-mono text-[12px] font-semibold text-slate-700 tabular-nums">
                            {ticket.ticket_id}
                          </span>
                          <BotonCopiar
                            ticketId={ticket.ticket_id}
                            copiado={copiado === ticket.ticket_id}
                            onCopiar={copiarTicket}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="max-w-[190px] truncate font-medium text-slate-800">
                          {ticket.nombre}
                        </p>
                        <p className="max-w-[190px] truncate text-[11px] text-slate-400">
                          {ticket.email}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="max-w-[280px] truncate text-slate-800">{ticket.asunto}</p>
                        <p className="text-[11px] text-slate-400">{ticket.tipo}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            PRIORIDAD_STYLES[prioridadKey] || 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {formatPrioridadLabel(ticket.prioridad)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            ESTADO_STYLES[estadoKey] || 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                          {formatEstadoLabel(ticket.estado)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p
                          className={`whitespace-nowrap text-[12px] font-semibold tabular-nums ${
                            SLA_TONES[sla.tone] || SLA_TONES.neutral
                          }`}
                        >
                          {sla.label}
                        </p>
                        <p className="text-[10px] text-slate-400">{sla.detalle}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {Number(ticket.total_documentos) > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                            <FileStack className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.75} />
                            <span className="tabular-nums">{ticket.total_documentos}</span>
                          </span>
                        ) : (
                          <span className="text-[12px] text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => abrirDetalle(ticket)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 active:scale-[0.98]"
                        >
                          Abrir
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={cerrarDetalle}
            className="absolute inset-0 cursor-default bg-slate-950/40 backdrop-blur-[2px]"
          />

          <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-900/[0.06] px-6 py-5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px] font-semibold text-indigo-600 tabular-nums">
                    {selectedTicket.ticket_id}
                  </span>
                  <BotonCopiar
                    ticketId={selectedTicket.ticket_id}
                    copiado={copiado === selectedTicket.ticket_id}
                    onCopiar={copiarTicket}
                    compacto
                  />
                </div>
                <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-900">
                  {selectedTicket.asunto}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      ESTADO_STYLES[normalizarClave(selectedTicket.estado)] ||
                      'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {formatEstadoLabel(selectedTicket.estado)}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      PRIORIDAD_STYLES[normalizarClave(selectedTicket.prioridad)] ||
                      'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {formatPrioridadLabel(selectedTicket.prioridad)}
                  </span>
                  <span className="text-[11px] text-slate-400 tabular-nums">
                    v{versionActual}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={cerrarDetalle}
                aria-label="Cerrar panel de detalle"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-[0.96]"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {loadingDetalle ? (
                <p className="py-12 text-center text-[13px] text-slate-400">
                  Cargando expediente...
                </p>
              ) : ticketDetalle ? (
                <div className="space-y-8">
                  <section>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Solicitante y asignación
                    </h3>
                    <dl className="mt-4 grid grid-cols-1 gap-5 text-[13px] sm:grid-cols-2">
                      <div>
                        <dt className="text-[11px] text-slate-400">Solicitante</dt>
                        <dd className="mt-1 font-medium text-slate-800">
                          {ticketDetalle.ticket.nombre_solicitante}
                        </dd>
                        <dd className="text-[12px] text-slate-500">
                          {ticketDetalle.ticket.email_solicitante}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-slate-400">Departamento asignado</dt>
                        <dd className="mt-1 font-medium text-slate-800">
                          {ticketDetalle.ticket.departamento}
                        </dd>
                        <dd className="text-[12px] text-slate-500 tabular-nums">
                          {ticketDetalle.ticket.sla_horas || 0} h de SLA
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-[11px] text-slate-400">Descripción del caso</dt>
                        <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-700">
                          {ticketDetalle.ticket.descripcion || 'Sin descripción adicional.'}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="border-t border-slate-900/[0.06] pt-6">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.75} />
                        Documentos y evidencias analizadas
                      </h3>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {ticketDetalle.documentos?.length || 0}
                      </span>
                    </div>

                    {!ticketDetalle.documentos?.length ? (
                      <p className="mt-3 text-[13px] text-slate-400">
                        No hay archivos adjuntos en este ticket.
                      </p>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-900/[0.06]">
                        {ticketDetalle.documentos.map((documento) => {
                          const confianza = formatConfianzaPct(documento.score_confianza);
                          return (
                            <div key={documento.id} className="py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <FileText
                                    className="h-4 w-4 shrink-0 text-indigo-500"
                                    strokeWidth={1.75}
                                  />
                                  <span className="truncate text-[13px] font-medium text-slate-800">
                                    {documento.nombre_archivo}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[11px] font-semibold text-slate-500 tabular-nums">
                                  {documento.categoria_detectada || 'Documento'}
                                  {confianza !== null ? ` · ${confianza}%` : ''}
                                </span>
                              </div>
                              {documento.resumen_ia ? (
                                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                                  {documento.resumen_ia}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="border-t border-slate-900/[0.06] pt-6">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Línea de tiempo y trazabilidad
                    </h3>

                    {!ticketDetalle.timeline?.length ? (
                      <p className="mt-3 text-[13px] text-slate-400">
                        Todavía no hay actividades registradas.
                      </p>
                    ) : (
                      <ol className="mt-4 space-y-5 border-l border-slate-900/[0.06] pl-5">
                        {ticketDetalle.timeline.map((actividad) => (
                          <li key={actividad.id} className="relative">
                            <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-4 ring-white" />
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                              <span className="font-semibold text-slate-700">
                                {actividad.autor_nombre}
                              </span>
                              <span className="text-slate-400">
                                {formatActorTipo(actividad.autor_tipo)}
                              </span>
                              <span className="text-[11px] text-slate-400 tabular-nums">
                                {formatFechaHora(actividad.created_at)}
                              </span>
                            </div>
                            {actividad.estado_nuevo ? (
                              <p className="mt-1 text-[11px] font-medium text-indigo-600">
                                Estado: {formatEstadoLabel(actividad.estado_nuevo)}
                              </p>
                            ) : null}
                            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
                              {actividad.mensaje}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section className="border-t border-slate-900/[0.06] pt-6">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Actualizar estado
                    </h3>

                    <form onSubmit={handleActualizarEstado} className="mt-4 space-y-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <select
                          value={nuevoEstado}
                          onChange={(event) => setNuevoEstado(event.target.value)}
                          aria-label="Nuevo estado del ticket"
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        >
                          {ESTADOS_FILTRO.map((estado) => (
                            <option key={estado} value={estado}>
                              {formatEstadoLabel(estado)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={actualizando}
                          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {actualizando ? 'Guardando...' : 'Aplicar cambio'}
                        </button>
                      </div>

                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                        <button
                          type="button"
                          onClick={() => setEsNotaInterna(false)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                            !esNotaInterna
                              ? 'bg-white text-slate-800 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                          Respuesta pública
                        </button>
                        <button
                          type="button"
                          onClick={() => setEsNotaInterna(true)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                            esNotaInterna
                              ? 'bg-white text-slate-800 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Lock className="h-3 w-3" strokeWidth={1.75} />
                          Nota interna
                        </button>
                      </div>

                      <textarea
                        value={nota}
                        onChange={(event) => setNota(event.target.value)}
                        rows={3}
                        placeholder={
                          esNotaInterna
                            ? 'Escribe una nota interna visible solo para el equipo...'
                            : 'Escribe la respuesta que verá el solicitante en el portal...'
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      />

                      {formError ? (
                        <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          <span>{formError}</span>
                        </p>
                      ) : null}
                      {formNotice ? (
                        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          <span>{formNotice}</span>
                        </p>
                      ) : null}
                    </form>
                  </section>
                </div>
              ) : (
                <p className="py-12 text-center text-[13px] text-slate-400">
                  No fue posible cargar el expediente.
                </p>
              )}
            </div>

            <footer className="flex flex-col gap-2 border-t border-slate-900/[0.06] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={consultarSolucionIA}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-[12px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 active:scale-[0.98]"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                Consultar solución con IA
              </button>
              <button
                type="button"
                onClick={cerrarDetalle}
                className="h-9 rounded-lg px-3 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 active:scale-[0.98]"
              >
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
