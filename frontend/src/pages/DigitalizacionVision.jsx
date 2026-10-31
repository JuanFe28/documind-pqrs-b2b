import React, { useState } from 'react';
import {
  Camera,
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Clock,
  Send,
  Sliders,
  Check,
  Copy,
  Layers,
} from 'lucide-react';
import axios from 'axios';

export default function DigitalizacionVision() {
  const [archivo, setArchivo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultadoVision, setResultadoVision] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Campos editables del formulario tras extracción de visión (Human-in-the-Loop)
  const [camposEditados, setCamposEditados] = useState({
    nombre_solicitante: '',
    email_solicitante: '',
    telefono_solicitante: '',
    tipo_solicitud: 'Petición',
    prioridad_sugerida: 'Media',
    area_sugerida: 'Soporte Técnico y Sistemas',
    asunto: '',
    descripcion: '',
  });

  const [radicando, setRadicando] = useState(false);
  const [radicadoExitoso, setRadicadoExitoso] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // Manejo de selección de archivo de imagen o PDF
  const handleSeleccionarArchivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setArchivo(file);
    setResultadoVision(null);
    setRadicadoExitoso(null);
    setErrorMsg('');

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
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
              Formatos soportados: JPG, PNG, WebP o PDF escaneado (hasta 15 MB).
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

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Descripción Extraída del Documento</label>
                  <textarea
                    rows={4}
                    required
                    value={camposEditados.descripcion}
                    onChange={(e) => setCamposEditados({ ...camposEditados, descripcion: e.target.value })}
                    placeholder="Detalles extraídos del formulario físico..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={radicando || !camposEditados.asunto || !camposEditados.descripcion}
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
