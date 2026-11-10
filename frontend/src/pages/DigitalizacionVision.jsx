import React, { useMemo, useState } from 'react';
import {
  Camera,
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ShieldCheck,
  RefreshCw,
  Send,
  Sliders,
  Check,
  Copy,
  Layers,
  Wand2,
} from 'lucide-react';
import axios from 'axios';

const MUESTRAS_DEMO = [
  {
    id: 'soporte',
    etiqueta: 'Muestra 1: Soporte Técnico',
    detalle: 'PQRS por falla de conectividad',
    url: '/muestras/01_soporte.jpg',
    nombre: 'muestra_soporte_tecnico.jpg',
  },
  {
    id: 'facturacion',
    etiqueta: 'Muestra 2: Facturación Duplicada',
    detalle: 'Reclamo por cobro repetido',
    url: '/muestras/02_facturacion.jpg',
    nombre: 'muestra_facturacion_duplicada.jpg',
  },
  {
    id: 'garantia',
    etiqueta: 'Muestra 3: Garantía Hardware',
    detalle: 'Solicitud de cambio de equipo',
    url: '/muestras/03_garantia.jpg',
    nombre: 'muestra_garantia_hardware.jpg',
  },
];

const CAMPOS_INICIALES = {
  nombre_solicitante: '',
  email_solicitante: '',
  telefono_solicitante: '',
  tipo_solicitud: 'Petición',
  prioridad_sugerida: 'Media',
  area_sugerida: 'Soporte Técnico y Sistemas',
  asunto: '',
  descripcion: '',
};

/**
 * Normaliza espacios, elimina la etiqueta "Descripción:" y descarta
 * frases repetidas conservando la primera aparición.
 */
function limpiarDescripcion(texto) {
  if (!texto) return '';

  const sinEtiqueta = String(texto)
    .replace(/\r/g, '')
    .replace(/^\s*(?:descripci[oó]n|detalle|motivo)\s*[:\-]\s*/i, '')
    .trim();

  const fragmentos = sinEtiqueta
    .split(/(?<=[.!?])\s+|\n+/)
    .map((fragmento) => fragmento.trim())
    .filter(Boolean);

  const vistos = new Set();
  const unicos = [];

  for (const fragmento of fragmentos) {
    const clave = fragmento
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúüñ]+/gi, ' ')
      .trim();
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(fragmento);
  }

  const resultado = unicos
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  return resultado || sinEtiqueta.replace(/\s+/g, ' ').trim();
}

function descripcionTieneRepeticion(texto) {
  const normalizado = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!normalizado) return false;
  return limpiarDescripcion(normalizado) !== normalizado;
}

export default function DigitalizacionVision() {
  const [archivo, setArchivo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultadoVision, setResultadoVision] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cargandoMuestra, setCargandoMuestra] = useState(null);

  // Campos editables del formulario tras extracción de visión (Human-in-the-Loop)
  const [camposEditados, setCamposEditados] = useState({ ...CAMPOS_INICIALES });

  const descripcionLegible = useMemo(
    () => limpiarDescripcion(camposEditados.descripcion),
    [camposEditados.descripcion]
  );
  const mostrarLimpiarFormato = useMemo(
    () => descripcionTieneRepeticion(camposEditados.descripcion),
    [camposEditados.descripcion]
  );

  const [radicando, setRadicando] = useState(false);
  const [radicadoExitoso, setRadicadoExitoso] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // Autorización de tratamiento de datos personales (Ley 1581 de 2012)
  const [autorizacionDatos, setAutorizacionDatos] = useState(false);
  // Confirmación explícita de revisión de campos con baja confianza
  const [revisionConfirmada, setRevisionConfirmada] = useState(false);

  // Manejo de selección de archivo de imagen o PDF
  const handleSeleccionarArchivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setArchivo(file);
    setResultadoVision(null);
    setRadicadoExitoso(null);
    setErrorMsg('');
    setRevisionConfirmada(false);

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  // Carga una muestra de demostración desde /public/muestras y la convierte en File
  const handleCargarMuestra = async (muestra) => {
    setCargandoMuestra(muestra.id);
    setErrorMsg('');

    try {
      const respuesta = await fetch(muestra.url, { cache: 'no-store' });
      if (!respuesta.ok) {
        throw new Error(`No se pudo obtener la muestra (HTTP ${respuesta.status}).`);
      }

      const blob = await respuesta.blob();
      const archivoMuestra = new File([blob], muestra.nombre, {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      });

      if (previewUrl) URL.revokeObjectURL(previewUrl);

      setArchivo(archivoMuestra);
      setPreviewUrl(URL.createObjectURL(archivoMuestra));
      setResultadoVision(null);
      setRadicadoExitoso(null);
      setRevisionConfirmada(false);
      setCamposEditados({ ...CAMPOS_INICIALES });
    } catch (err) {
      console.error('Error al cargar muestra de demostración:', err);
      setErrorMsg(
        'No se pudo cargar la muestra de demostración. Verifique que las imágenes estén disponibles en /muestras/.'
      );
    } finally {
      setCargandoMuestra(null);
    }
  };

  const handleLimpiarFormato = () => {
    setCamposEditados((prev) => ({
      ...prev,
      descripcion: limpiarDescripcion(prev.descripcion),
    }));
  };

  // Procesamiento con IA Multimodal
  const handleProcesarConVision = async () => {
    if (!archivo) {
      setErrorMsg('Seleccione o tome una foto de un formulario físico primero.');
      return;
    }

    setProcesando(true);
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('archivo', archivo);

      const res = await axios.post('/api/vision/procesar-formulario', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const data = res.data;
      setResultadoVision(data);

      const ext = data.datos_extraidos || {};
      setCamposEditados({
        nombre_solicitante: ext.nombre_solicitante || '',
        email_solicitante: ext.email_solicitante || '',
        telefono_solicitante: ext.telefono_solicitante || '',
        tipo_solicitud: ext.tipo_solicitud || 'Petición',
        prioridad_sugerida: ext.prioridad_sugerida || 'Media',
        area_sugerida: ext.area_sugerida || 'Soporte Técnico y Sistemas',
        asunto: ext.asunto || '',
        descripcion: ext.descripcion || '',
      });
    } catch (err) {
      console.error('Error en visión:', err);
      setErrorMsg(err.response?.data?.mensaje || 'Error al procesar la imagen con el módulo de visión.');
    } finally {
      setProcesando(false);
    }
  };

  // Disparo del proceso de negocio nativo en Express (Ruta A)
  const handleConfirmarYRadicar = async (e) => {
    e.preventDefault();
    if (!autorizacionDatos) {
      setErrorMsg('Debe autorizar el tratamiento de sus datos personales (Ley 1581 de 2012) para radicar.');
      return;
    }
    if (resultadoVision?.requiere_revision_humana && !revisionConfirmada) {
      setErrorMsg('Debe confirmar que revisó y corrigió manualmente los campos con confianza menor al 85%.');
      return;
    }
    setRadicando(true);
    setErrorMsg('');

    try {
      const payload = {
        request_id: crypto.randomUUID(),
        nombre_solicitante: camposEditados.nombre_solicitante,
        email_solicitante: camposEditados.email_solicitante,
        telefono: camposEditados.telefono_solicitante,
        tipo_solicitud: camposEditados.tipo_solicitud,
        prioridad: camposEditados.prioridad_sugerida,
        departamento: camposEditados.area_sugerida,
        asunto: camposEditados.asunto,
        descripcion: `${camposEditados.descripcion}\n\n[Digitalizado con Visión IA - Modelo: ${resultadoVision?.modelo_utilizado || 'Gemini Flash'}]`,
      };

      const res = await axios.post('/api/pqrs/radicar', payload);
      setRadicadoExitoso(res.data);
    } catch (err) {
      console.error('Error al radicar ticket:', err);
      setErrorMsg(err.response?.data?.mensaje || 'Error al radicar la solicitud en el motor de automatización.');
    } finally {
      setRadicando(false);
    }
  };

  const copiarToken = () => {
    if (!radicadoExitoso?.tracking_token) return;
    navigator.clipboard.writeText(radicadoExitoso.tracking_token);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Cabecera del Módulo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              <Camera className="w-3.5 h-3.5" /> Componente 2 · IA Multimodal & Visión
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Digitalización de Formularios Físicos PQRS
            </h1>
            <p className="text-slate-400 text-sm max-w-2xl">
              Cargue o capture con el celular fotografías de formularios impresos, facturas o novedades.
              El módulo extrae los campos con Google Gemini Vision, calcula el score de confianza y dispara
              la radicación en el motor de automatización propio.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-medium text-slate-300">Motor de Visión Operativo</span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center gap-3 text-rose-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Barra de pruebas rápidas para demostración */}
      <div className="bg-slate-900/80 border border-indigo-500/30 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Formularios y Fotos de Prueba para Demostración
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Seleccione una muestra con un clic y luego pulse{' '}
              <strong className="text-slate-200">Analizar con Visión por Computador</strong>. No necesita buscar
              archivos en su equipo: las imágenes ya están disponibles en la aplicación.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-semibold text-indigo-300 uppercase tracking-wide flex-shrink-0">
            <Sparkles className="w-3 h-3" /> Demo guiada
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MUESTRAS_DEMO.map((muestra) => {
            const activa = archivo?.name === muestra.nombre;
            const cargando = cargandoMuestra === muestra.id;

            return (
              <button
                key={muestra.id}
                type="button"
                onClick={() => handleCargarMuestra(muestra)}
                disabled={Boolean(cargandoMuestra) || procesando}
                className={`group flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  activa
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-slate-700 bg-slate-950/50 hover:border-indigo-500/40 hover:bg-slate-800/60'
                }`}
              >
                <span className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                  {cargando ? (
                    <RefreshCw className="w-4 h-4 text-indigo-300 animate-spin" />
                  ) : activa ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <FileText className="w-4 h-4 text-indigo-300" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-100 truncate">{muestra.etiqueta}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{muestra.detalle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Área Principal de Trabajo: Carga vs Extracción */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Columna Izquierda: Captura de Imagen */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
              1. Capturar Formulario Físico
            </h2>
            <p className="text-xs text-slate-400">
              Formatos soportados: JPG, PNG, WebP o PDF escaneado (hasta 15 MB). También puede cargar una
              muestra de demostración desde la barra superior.
            </p>

            <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-xl p-6 text-center transition-all bg-slate-950/40 relative group">
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={handleSeleccionarArchivo}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              {previewUrl ? (
                <div className="space-y-3">
                  <img
                    src={previewUrl}
                    alt="Previsualización de formulario físico"
                    className="max-h-64 mx-auto rounded-lg shadow-md border border-slate-700 object-contain"
                  />
                  <p className="text-xs text-emerald-400 font-medium flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {archivo?.name} ({(archivo?.size / 1024).toFixed(0)} KB)
                  </p>
                </div>
              ) : archivo ? (
                <div className="space-y-2 py-4">
                  <FileText className="w-12 h-12 text-indigo-400 mx-auto" />
                  <p className="text-sm font-medium text-white">{archivo.name}</p>
                  <p className="text-xs text-slate-400">Documento PDF cargado</p>
                </div>
              ) : (
                <div className="space-y-3 py-6">
                  <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      Tome una foto con celular o arrastre el archivo
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Haga clic para examinar</p>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleProcesarConVision}
              disabled={!archivo || procesando}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all"
            >
              {procesando ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Analizando Imagen con IA Multimodal...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Analizar con Visión por Computador
                </>
              )}
            </button>
          </div>

          {/* Tarjeta de Metadatos de Confianza */}
          {resultadoVision && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                Métricas de Extracción
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Score de Confianza Global:</span>
                  <span className={`font-bold ${resultadoVision.score_confianza >= 0.85 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {(resultadoVision.score_confianza * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${resultadoVision.score_confianza >= 0.85 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${resultadoVision.score_confianza * 100}%` }}
                  />
                </div>
              </div>

              {resultadoVision.requiere_revision_humana && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Revisión Humana Requerida:</strong> La confianza es inferior al umbral del 85% o existen campos ambiguos. Por favor verifique los datos antes de radicar.
                  </span>
                </div>
              )}

              <div className="text-xs text-slate-400 pt-2 border-t border-slate-800 space-y-1">
                <p><strong>Modelo:</strong> {resultadoVision.modelo_utilizado}</p>
                {resultadoVision.es_plan_b && (
                  <p className="text-amber-400"><strong>Modo:</strong> Plan B de Resiliencia Local</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Columna Derecha: Formulario Human-in-the-Loop y Radicación */}
        <div className="lg:col-span-7">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                2. Validación Humana (Human-in-the-Loop)
              </h2>
              {resultadoVision && (
                <span className="text-xs px-2.5 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded-md">
                  Campos Extraídos por IA
                </span>
              )}
            </div>

            {radicadoExitoso ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-5 animate-scaleUp">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">¡Formulario Radicado con Éxito!</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    El documento físico fue procesado por el motor de visión y creado en PostgreSQL sin depender de n8n.
                  </p>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-left space-y-3 font-mono text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-xs">Número de Radicado:</span>
                    <span className="text-emerald-400 font-bold">{radicadoExitoso.ticket_id}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-xs">SLA Máximo:</span>
                    <span className="text-indigo-400 font-semibold">{radicadoExitoso.sla_horas} Horas Corridas</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                    <span className="text-slate-400 text-xs">Token de Consulta:</span>
                    <button
                      type="button"
                      onClick={copiarToken}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 px-2 py-1 rounded"
                    >
                      {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {radicadoExitoso.tracking_token ? `${radicadoExitoso.tracking_token.slice(0, 12)}...` : 'N/A'}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setArchivo(null);
                    setPreviewUrl(null);
                    setResultadoVision(null);
                    setRadicadoExitoso(null);
                    setAutorizacionDatos(false);
                    setRevisionConfirmada(false);
                  }}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  Digitalizar Otro Formulario
                </button>
              </div>
            ) : (
              <form onSubmit={handleConfirmarYRadicar} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Nombre del Solicitante</label>
                    <input
                      type="text"
                      required
                      value={camposEditados.nombre_solicitante}
                      onChange={(e) => setCamposEditados({ ...camposEditados, nombre_solicitante: e.target.value })}
                      placeholder="Ej. Juan Pérez"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      value={camposEditados.email_solicitante}
                      onChange={(e) => setCamposEditados({ ...camposEditados, email_solicitante: e.target.value })}
                      placeholder="correo@ejemplo.com"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Teléfono</label>
                    <input
                      type="text"
                      value={camposEditados.telefono_solicitante}
                      onChange={(e) => setCamposEditados({ ...camposEditados, telefono_solicitante: e.target.value })}
                      placeholder="3001234567"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Tipo de Solicitud</label>
                    <select
                      value={camposEditados.tipo_solicitud}
                      onChange={(e) => setCamposEditados({ ...camposEditados, tipo_solicitud: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Petición">Petición</option>
                      <option value="Queja">Queja</option>
                      <option value="Reclamo">Reclamo</option>
                      <option value="Soporte Técnico">Soporte Técnico</option>
                      <option value="Sugerencia">Sugerencia</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Prioridad</label>
                    <select
                      value={camposEditados.prioridad_sugerida}
                      onChange={(e) => setCamposEditados({ ...camposEditados, prioridad_sugerida: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Baja">Baja (48h)</option>
                      <option value="Media">Media (24h)</option>
                      <option value="Alta">Alta (4h)</option>
                      <option value="Crítica">Crítica (2h)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Departamento Asignado</label>
                  <select
                    value={camposEditados.area_sugerida}
                    onChange={(e) => setCamposEditados({ ...camposEditados, area_sugerida: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Soporte Técnico y Sistemas">Soporte Técnico y Sistemas</option>
                    <option value="Facturación y Cobranzas">Facturación y Cobranzas</option>
                    <option value="Control de Calidad y Garantías">Control de Calidad y Garantías</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Asunto</label>
                  <input
                    type="text"
                    required
                    value={camposEditados.asunto}
                    onChange={(e) => setCamposEditados({ ...camposEditados, asunto: e.target.value })}
                    placeholder="Resumen del requerimiento"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div>
                      <label
                        htmlFor="descripcion-extraida"
                        className="text-xs font-semibold text-slate-300"
                      >
                        Descripción Extraída del Documento
                      </label>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Texto transcrito por la IA. Verifique que sea claro y completo; puede editarlo
                        antes de radicar.
                      </p>
                    </div>
                    {mostrarLimpiarFormato && (
                      <button
                        type="button"
                        onClick={handleLimpiarFormato}
                        title="Elimina frases repetidas y normaliza los espacios"
                        className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-500/20 transition-colors flex-shrink-0"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        Limpiar formato
                      </button>
                    )}
                  </div>

                  <textarea
                    id="descripcion-extraida"
                    rows={4}
                    required
                    aria-describedby="descripcion-ayuda"
                    value={camposEditados.descripcion}
                    onChange={(e) => setCamposEditados({ ...camposEditados, descripcion: e.target.value })}
                    placeholder="Ej. El usuario reporta fallas de conectividad desde el 12 de mayo y solicita revisión del servicio..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />

                  <div
                    id="descripcion-ayuda"
                    className="rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2 text-[11px] text-slate-400 leading-relaxed"
                  >
                    <span className="font-semibold text-slate-300">Vista legible: </span>
                    {descripcionLegible ||
                      'Aún no hay una descripción extraída. Cargue una muestra o procese un formulario para verla aquí.'}
                    {mostrarLimpiarFormato && (
                      <span className="block mt-1 text-amber-400/90">
                        Se detectó texto repetido o espacios innecesarios. Use «Limpiar formato» para
                        normalizar la descripción.
                      </span>
                    )}
                  </div>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-300 bg-slate-950/60 border border-slate-700 rounded-xl p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autorizacionDatos}
                    onChange={(e) => setAutorizacionDatos(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-500 flex-shrink-0"
                  />
                  <span>
                    Autorizo el tratamiento de mis datos personales conforme a la <strong>Ley 1581 de 2012</strong> y la política de privacidad de la entidad.
                  </span>
                </label>

                {resultadoVision?.requiere_revision_humana && (
                  <label className="flex items-start gap-2.5 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={revisionConfirmada}
                      onChange={(e) => setRevisionConfirmada(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-500 flex-shrink-0"
                    />
                    <span>
                      Confirmo que he revisado y corregido manualmente los campos con confianza menor al 85%.
                    </span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={
                    radicando ||
                    !camposEditados.asunto ||
                    !camposEditados.descripcion ||
                    !autorizacionDatos ||
                    (resultadoVision?.requiere_revision_humana && !revisionConfirmada)
                  }
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all mt-4"
                >
                  {radicando ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Radicando en Motor de Automatización Propio...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Confirmar y Radicar Ticket PQRS
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

