/**
 * Utilidades de presentación compartidas para el dominio PQRS.
 * Los valores canónicos permanecen intactos para la API; aquí solo se
 * normalizan etiquetas visibles y se sanitizan salidas CSV.
 */

export const ESTADOS_CANONICOS = [
  'NUEVO',
  'ASIGNADO',
  'EN_GESTION',
  'ESPERANDO_CLIENTE',
  'RESUELTO',
  'CERRADO',
];

export const PRIORIDADES_CANONICAS = ['Crítica', 'Alta', 'Media', 'Baja'];

const ESTADO_LABELS = {
  NUEVO: 'Nuevo',
  ASIGNADO: 'Asignado',
  EN_GESTION: 'En Gestión',
  ESPERANDO_CLIENTE: 'Esperando Cliente',
  RESUELTO: 'Resuelto',
  CERRADO: 'Cerrado',
};

const PRIORIDAD_LABELS = {
  CRITICA: 'Crítica',
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};

const ACTOR_LABELS = {
  AGENTE: 'Agente',
  CLIENTE: 'Cliente',
  CIUDADANO: 'Ciudadano',
  SISTEMA: 'Sistema',
  AUTOMATIZACION: 'Automatización',
  IA: 'Asistente IA',
};

export function normalizarClave(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

export function formatEstadoLabel(estado) {
  const clave = normalizarClave(estado);
  return ESTADO_LABELS[clave] || 'Sin estado';
}

export function formatPrioridadLabel(prioridad) {
  const clave = normalizarClave(prioridad);
  return PRIORIDAD_LABELS[clave] || 'Sin prioridad';
}

export function formatPrioridadValue(prioridad) {
  const label = formatPrioridadLabel(prioridad);
  return label === 'Sin prioridad' ? '' : label;
}

export function formatActorTipo(tipo) {
  const clave = normalizarClave(tipo);
  return ACTOR_LABELS[clave] || (tipo ? String(tipo) : 'Sistema');
}

export function formatFechaHora(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatConfianzaPct(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return Math.round(numero <= 1 ? numero * 100 : numero);
}

export function estadoSla(ticket) {
  const estado = normalizarClave(ticket?.estado);
  if (estado === 'RESUELTO' || estado === 'CERRADO') {
    return { tone: 'neutral', label: 'Finalizado', detalle: 'Ciclo cerrado' };
  }

  const limite = ticket?.sla_fecha_limite ? new Date(ticket.sla_fecha_limite) : null;
  if (!limite || Number.isNaN(limite.getTime())) {
    return { tone: 'neutral', label: 'Sin SLA', detalle: `${ticket?.sla_horas || 0} h configuradas` };
  }

  const horasRestantes = (limite.getTime() - Date.now()) / 3600000;
  const horas = Math.abs(horasRestantes);

  if (horasRestantes < 0) {
    return {
      tone: 'late',
      label: `${Math.ceil(horas)} h vencidas`,
      detalle: 'SLA fuera de plazo',
    };
  }
  if (horasRestantes <= 4) {
    return {
      tone: 'warning',
      label: `${Math.max(1, Math.ceil(horasRestantes))} h restantes`,
      detalle: 'SLA próximo a vencer',
    };
  }
  return {
    tone: 'ok',
    label: `${Math.ceil(horasRestantes)} h restantes`,
    detalle: 'Dentro del plazo',
  };
}

/**
 * Sanitiza una celda CSV: neutraliza fórmulas, escapa comillas y delimita
 * el valor para admitir comas, saltos de línea y punto y coma.
 */
export function csvCell(valor) {
  if (valor === null || valor === undefined) return '""';
  let texto = String(valor);
  if (/^[=+\-@]/.test(texto)) {
    texto = `'${texto}`;
  }
  return `"${texto.replace(/"/g, '""')}"`;
}
