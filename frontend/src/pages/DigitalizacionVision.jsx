import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Wand2,
  ChevronDown,
  Database,
  FolderOpen,
  Lock,
  LogIn,
  MessageSquare,
  Save,
} from 'lucide-react';
import { visionAPI, automationAPI, repositoriesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const EJEMPLOS_RAPIDOS = [
  {
    id: 'soporte',
    etiqueta: 'Soporte técnico',
    detalle: 'PQRS por falla de conectividad',
    url: '/muestras/01_soporte.jpg',
    nombre: 'soporte_tecnico.jpg',
  },
  {
    id: 'facturacion',
    etiqueta: 'Facturación duplicada',
    detalle: 'Reclamo por cobro repetido',
    url: '/muestras/02_facturacion.jpg',
    nombre: 'facturacion_duplicada.jpg',
  },
  {
    id: 'garantia',
    etiqueta: 'Garantía de hardware',
    detalle: 'Solicitud de cambio de equipo',
    url: '/muestras/03_garantia.jpg',
    nombre: 'garantia_hardware.jpg',
  },
];

const TIPOS_DOCUMENTO = [
  'Factura',
  'Contrato',
  'Documento de Identidad',
  'Acta',
  'Normativa',
  'Soporte General',
];

const CAMPOS_PQRS_INICIALES = {
  nombre_solicitante: '',
  email_solicitante: '',
  telefono_solicitante: '',
  tipo_solicitud: 'Petición',
  prioridad_sugerida: 'Media',
  area_sugerida: 'Soporte Técnico y Sistemas',
  asunto: '',
  descripcion: '',
};

const ENTIDADES_INICIALES = {
  emisor: '',
  receptor: '',
  documento_id_o_nit: '',
  fecha_documento: '',
  monto_total: '',
};

const CAMPOS_BOVEDA_INICIALES = {
  titulo_sugerido: '',
  tipo_documento: 'Soporte General',
  repositorio_id: '',
  resumen_ejecutivo: '',
  texto_ocr_completo: '',
  entidades_clave: { ...ENTIDADES_INICIALES },
};

const INPUT_CLASS =
  'w-full bg-[var(--color-bg-main)] border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-ring)] transition-colors';

const LABEL_CLASS = 'text-xs font-semibold text-[var(--color-text)]';

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

function nombreSinExtension(nombreArchivo) {
  return String(nombreArchivo || '').replace(/\.[^.]+$/, '').trim();
}

function campoEntidad(valor) {
  return valor === null || valor === undefined ? '' : String(valor);
}

export default function DigitalizacionVision() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [modo, setModo] = useState(isAuthenticated ? 'boveda' : 'pqrs');

  const [archivo, setArchivo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultadoVision, setResultadoVision] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cargandoMuestra, setCargandoMuestra] = useState(null);
  const [menuEjemplosAbierto, setMenuEjemplosAbierto] = useState(false);

  const fileInputRef = useRef(null);
  const menuEjemplosRef = useRef(null);

  // Repositorios destino para la Bóveda Documental
  const [repositorios, setRepositorios] = useState([]);
  const [cargandoRepos, setCargandoRepos] = useState(false);
  const [errorRepos, setErrorRepos] = useState('');

  // Campos editables del flujo PQRS
  const [camposEditados, setCamposEditados] = useState({ ...CAMPOS_PQRS_INICIALES });

  // Campos editables del flujo Bóveda Documental
  const [camposBoveda, setCamposBoveda] = useState({ ...CAMPOS_BOVEDA_INICIALES });

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

  const [indexando, setIndexando] = useState(false);
  const [indexadoExitoso, setIndexadoExitoso] = useState(null);

  // Autorización de tratamiento de datos personales (Ley 1581 de 2012)
  const [autorizacionDatos, setAutorizacionDatos] = useState(false);
  // Confirmación explícita de revisión de campos con baja confianza
  const [revisionConfirmada, setRevisionConfirmada] = useState(false);

  // Libera la Object URL de la vista previa al cambiar de archivo o desmontar
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Carga los repositorios visibles para el funcionario autenticado
  useEffect(() => {
    let activo = true;

    if (!isAuthenticated) {
      setRepositorios([]);
      setCargandoRepos(false);
      setErrorRepos('');
      return () => {
        activo = false;
      };
    }

    setCargandoRepos(true);
    setErrorRepos('');

    repositoriesAPI
      .list()
      .then((res) => {
        if (!activo) return;
        const lista = res.data?.repositorios || [];
        setRepositorios(lista);
        setCamposBoveda((prev) => {
          const seleccionValida = lista.some(
            (repo) => String(repo.id) === String(prev.repositorio_id)
          );
          if (seleccionValida) return prev;
          return {
            ...prev,
            repositorio_id: lista.length > 0 ? String(lista[0].id) : '',
          };
        });
      })
      .catch((err) => {
        if (!activo) return;
        setRepositorios([]);
        setErrorRepos(
          err.response?.data?.mensaje || 'No fue posible cargar los repositorios disponibles.'
        );
      })
      .finally(() => {
        if (activo) setCargandoRepos(false);
      });

    return () => {
      activo = false;
    };
  }, [isAuthenticated]);

  // Cierra el menú de ejemplos al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!menuEjemplosAbierto) return undefined;

    const handleClickFuera = (event) => {
      if (!menuEjemplosRef.current?.contains(event.target)) {
        setMenuEjemplosAbierto(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setMenuEjemplosAbierto(false);
    };

    document.addEventListener('mousedown', handleClickFuera);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickFuera);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuEjemplosAbierto]);

  const repoSeleccionado = useMemo(
    () => repositorios.find((repo) => String(repo.id) === String(camposBoveda.repositorio_id)) || null,
    [repositorios, camposBoveda.repositorio_id]
  );

  const bovedaBloqueada = modo === 'boveda' && !isAuthenticated;
  const faltaRepositorio = modo === 'boveda' && isAuthenticated && !camposBoveda.repositorio_id;

  const limpiarResultados = () => {
    setResultadoVision(null);
    setRadicadoExitoso(null);
    setIndexadoExitoso(null);
    setRevisionConfirmada(false);
    setErrorMsg('');
  };

  const cambiarModo = (nuevoModo) => {
    if (nuevoModo === modo) return;
    setModo(nuevoModo);
    limpiarResultados();
  };

  const handleSeleccionarArchivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg('El archivo excede el límite de 15 MB.');
      return;
    }

    setArchivo(file);
    setResultadoVision(null);
    setRadicadoExitoso(null);
    setIndexadoExitoso(null);
    setErrorMsg('');
    setRevisionConfirmada(false);
    setPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCargarMuestra = async (muestra) => {
    setMenuEjemplosAbierto(false);
    setCargandoMuestra(muestra.id);
    setErrorMsg('');

    let archivoMuestra = null;

    try {
      const respuesta = await fetch(muestra.url, { cache: 'no-store' });
      if (!respuesta.ok) {
        throw new Error(`No se pudo obtener el ejemplo (HTTP ${respuesta.status}).`);
      }

      const blob = await respuesta.blob();
      archivoMuestra = new File([blob], muestra.nombre, {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      });

      setArchivo(archivoMuestra);
      setResultadoVision(null);
      setRadicadoExitoso(null);
      setIndexadoExitoso(null);
      setRevisionConfirmada(false);
      setCamposEditados({ ...CAMPOS_PQRS_INICIALES });
      setCamposBoveda((prev) => ({
        ...CAMPOS_BOVEDA_INICIALES,
        repositorio_id: prev.repositorio_id,
        entidades_clave: { ...ENTIDADES_INICIALES },
      }));
      setPreviewUrl(URL.createObjectURL(archivoMuestra));
    } catch (err) {
      console.error('Error al cargar el ejemplo:', err);
      setErrorMsg('No fue posible cargar el ejemplo. Verifique que las imágenes estén disponibles.');
      setCargandoMuestra(null);
      return;
    }

    await procesarArchivo(archivoMuestra);
    setCargandoMuestra(null);
  };

  const handleLimpiarFormato = () => {
    setCamposEditados((prev) => ({
      ...prev,
      descripcion: limpiarDescripcion(prev.descripcion),
    }));
  };

  // Procesamiento con IA multimodal según el modo de destino
  const procesarArchivo = async (archivoParaProcesar) => {
    if (!archivoParaProcesar) {
      setErrorMsg('Selecciona o captura un documento primero.');
      return;
    }

    if (modo === 'boveda') {
      if (!isAuthenticated) {
        setErrorMsg('Inicia sesión como funcionario para indexar documentos en la Bóveda Documental.');
        return;
      }
      if (!camposBoveda.repositorio_id) {
        setErrorMsg('Selecciona el repositorio destino antes de analizar el documento.');
        return;
      }
    }

    setProcesando(true);
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('archivo', archivoParaProcesar);
      if (modo === 'boveda') {
        formData.append('modo', 'boveda');
      } else {
        formData.append('modo', 'pqrs');
      }

      const res = await visionAPI.procesarFormulario(formData);
      const data = res.data || {};
      setResultadoVision(data);

      if (modo === 'boveda') {
        const doc = data.datos_documento || {};
        const entidades = doc.entidades_clave || {};
        const tipoDocumento = TIPOS_DOCUMENTO.includes(doc.tipo_documento)
          ? doc.tipo_documento
          : 'Soporte General';

        setCamposBoveda((prev) => ({
          ...prev,
          titulo_sugerido:
            doc.titulo_sugerido || nombreSinExtension(archivoParaProcesar.name),
          tipo_documento: tipoDocumento,
          resumen_ejecutivo: doc.resumen_ejecutivo || '',
          texto_ocr_completo: doc.texto_ocr_completo || '',
          entidades_clave: {
            emisor: campoEntidad(entidades.emisor),
            receptor: campoEntidad(entidades.receptor),
            documento_id_o_nit: campoEntidad(entidades.documento_id_o_nit),
            fecha_documento: campoEntidad(entidades.fecha_documento),
            monto_total: campoEntidad(entidades.monto_total),
          },
        }));
      } else {
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
      }
    } catch (err) {
      console.error('Error en visión:', err);
      setErrorMsg(
        err.response?.data?.mensaje || 'Error al procesar el documento con el módulo de visión.'
      );
    } finally {
      setProcesando(false);
    }
  };

  const handleProcesarConVision = () => procesarArchivo(archivo);

  const actualizarEntidad = (campo, valor) => {
    setCamposBoveda((prev) => ({
      ...prev,
      entidades_clave: {
        ...prev.entidades_clave,
        [campo]: valor,
      },
    }));
  };

  // Indexación en la Bóveda Documental (Modo 1)
  const handleGuardarEIndexar = async (e) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setErrorMsg('Inicia sesión como funcionario para indexar documentos en la Bóveda Documental.');
      return;
    }
    if (!resultadoVision) {
      setErrorMsg('Analiza un documento con IA antes de indexarlo en la Bóveda.');
      return;
    }
    if (!camposBoveda.repositorio_id) {
      setErrorMsg('Selecciona el repositorio destino para continuar.');
      return;
    }
    if (!camposBoveda.titulo_sugerido.trim()) {
      setErrorMsg('El título del documento es obligatorio.');
      return;
    }
    if (!camposBoveda.resumen_ejecutivo.trim() && !camposBoveda.texto_ocr_completo.trim()) {
      setErrorMsg('El documento no contiene resumen ni texto extraído para indexar.');
      return;
    }

    setIndexando(true);
    setErrorMsg('');

    try {
      const repositorioId = Number(camposBoveda.repositorio_id);
      const payload = {
        archivo_servidor: resultadoVision.archivo?.archivo_servidor,
        score_confianza: resultadoVision.score_confianza,
        repositorio_id: repositorioId,
        titulo_archivo: camposBoveda.titulo_sugerido.trim(),
        tipo_documento: camposBoveda.tipo_documento,
        resumen_ejecutivo: camposBoveda.resumen_ejecutivo.trim(),
        texto_ocr_completo: camposBoveda.texto_ocr_completo.trim(),
        metadatos: {
          entidades_clave: camposBoveda.entidades_clave,
          modelo_utilizado: resultadoVision.modelo_utilizado || null,
          archivo_original: resultadoVision.archivo?.nombre || archivo?.name || null,
          sha256: resultadoVision.archivo?.sha256 || null,
        },
      };

      const res = await visionAPI.indexarDocumento(payload);
      const repo = repositorios.find((item) => Number(item.id) === repositorioId);

      setIndexadoExitoso({
        documento: res.data?.documento || {},
        chunks: res.data?.chunks_indexados ?? 0,
        repositorioId,
        repositorioNombre: repo?.nombre || `Repositorio #${repositorioId}`,
      });
    } catch (err) {
      console.error('Error al indexar documento:', err);
      setErrorMsg(
        err.response?.data?.mensaje || 'No fue posible indexar el documento en la Bóveda Documental.'
      );
    } finally {
      setIndexando(false);
    }
  };

  // Radicación PQRS (Modo 2)
  const handleConfirmarYRadicar = async (e) => {
    e.preventDefault();

    if (!autorizacionDatos) {
      setErrorMsg(
        'Debe autorizar el tratamiento de sus datos personales (Ley 1581 de 2012) para radicar.'
      );
      return;
    }
    if (resultadoVision?.requiere_revision_humana && !revisionConfirmada) {
      setErrorMsg(
        'Debe confirmar que revisó y corrigió manualmente los campos con confianza menor al 85%.'
      );
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
        descripcion: camposEditados.descripcion,
      };

      const res = await automationAPI.radicar(payload);
      setRadicadoExitoso(res.data);
    } catch (err) {
      console.error('Error al radicar caso PQRS:', err);
      setErrorMsg(
        err.response?.data?.mensaje || 'Error al radicar la solicitud.'
      );
    } finally {
      setRadicando(false);
    }
  };

  const resetEscanner = () => {
    setArchivo(null);
    setPreviewUrl(null);
    setResultadoVision(null);
    setRadicadoExitoso(null);
    setIndexadoExitoso(null);
    setAutorizacionDatos(false);
    setRevisionConfirmada(false);
    setErrorMsg('');
    setCamposEditados({ ...CAMPOS_PQRS_INICIALES });
    setCamposBoveda((prev) => ({
      ...CAMPOS_BOVEDA_INICIALES,
      repositorio_id: prev.repositorio_id,
      entidades_clave: { ...ENTIDADES_INICIALES },
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copiarToken = () => {
    if (!radicadoExitoso?.tracking_token) return;
    navigator.clipboard.writeText(radicadoExitoso.tracking_token);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const scoreConfianza = Number(resultadoVision?.score_confianza ?? 0);

  return (
    <div
      id="pantalla-digitalizacion"
      className="min-h-screen w-full bg-[var(--color-bg-main)] p-4 sm:p-6 lg:p-8 space-y-6 animate-fadeIn"
    >
      {/* Cabecera del módulo */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 sm:p-8 shadow-[var(--shadow-card)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--color-accent-soft)] border border-[var(--color-border)] rounded-full text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wider">
              <Camera className="w-3.5 h-3.5" strokeWidth={1.75} /> Escáner Documental Universal
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight">
              Escáner Documental Inteligente
            </h1>
            <p className="text-[var(--color-text-muted)] text-sm max-w-2xl">
              Extraiga información de contratos, facturas, evidencias o formularios físicos con IA
              multimodal para indexar en bóveda o radicar casos PQRS.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] px-3 py-1.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                {isAuthenticated ? 'Sesión de funcionario activa' : 'Acceso público · Radicación PQRS'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center gap-3 text-[var(--color-danger)] text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" strokeWidth={1.75} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Selector de destino */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 sm:p-5 shadow-[var(--shadow-card)]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
          Destino de la digitalización
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => cambiarModo('boveda')}
            className={`group text-left rounded-xl border p-4 transition-all active:scale-[0.99] ${
              modo === 'boveda'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] shadow-sm'
                : 'border-[var(--color-border)] bg-[var(--color-bg-main)] hover:border-[var(--color-accent)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  modo === 'boveda'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'
                }`}
              >
                <Database className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  Digitalizar hacia Bóveda Documental
                  {!isAuthenticated && (
                    <Lock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" strokeWidth={1.75} />
                  )}
                </span>
                <span className="mt-1 block text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Sube o escanea facturas, contratos, cédulas o documentos generales y los indexa en
                  un repositorio para consultas RAG.
                </span>
              </span>
              {modo === 'boveda' && (
                <CheckCircle2
                  className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0"
                  strokeWidth={1.75}
                />
              )}
            </div>
          </button>

          <button
            type="button"
            onClick={() => cambiarModo('pqrs')}
            className={`group text-left rounded-xl border p-4 transition-all active:scale-[0.99] ${
              modo === 'pqrs'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] shadow-sm'
                : 'border-[var(--color-border)] bg-[var(--color-bg-main)] hover:border-[var(--color-accent)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  modo === 'pqrs'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'
                }`}
              >
                <Send className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  Digitalizar y Radicar Caso PQRS
                </span>
                <span className="mt-1 block text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Procesa formularios y evidencias PQRS, verifica los campos extraídos y radica el
                  caso en el flujo de atención.
                </span>
              </span>
              {modo === 'pqrs' && (
                <CheckCircle2
                  className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0"
                  strokeWidth={1.75}
                />
              )}
            </div>
          </button>
        </div>
      </div>

      {bovedaBloqueada ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 sm:p-12 shadow-[var(--shadow-card)] text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto">
            <Lock className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h2 className="mt-4 text-xl font-bold text-[var(--color-text)]">
            Bóveda Documental para funcionarios
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
            Inicia sesión como funcionario para indexar documentos en la Bóveda Documental.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold rounded-xl shadow-sm active:scale-[0.98] transition-all"
          >
            <LogIn className="w-4 h-4" strokeWidth={1.75} />
            Iniciar sesión
          </button>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            Si solo necesitas radicar una PQRS, cambia al modo PQRS y continúa sin iniciar sesión.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Columna izquierda: carga y análisis */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                    <UploadCloud
                      className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0"
                      strokeWidth={1.75}
                    />
                    1. Cargar documento o fotografía
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Formatos soportados: JPG, PNG, WebP o PDF escaneado (hasta 15 MB).
                  </p>
                </div>

                <div className="relative flex-shrink-0" ref={menuEjemplosRef}>
                  <button
                    type="button"
                    onClick={() => setMenuEjemplosAbierto((abierto) => !abierto)}
                    disabled={procesando || Boolean(cargandoMuestra)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-main)] text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {cargandoMuestra ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
                    )}
                    Cargar ejemplo
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${menuEjemplosAbierto ? 'rotate-180' : ''}`}
                      strokeWidth={1.75}
                    />
                  </button>

                  {menuEjemplosAbierto && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
                      {EJEMPLOS_RAPIDOS.map((muestra) => {
                        const cargando = cargandoMuestra === muestra.id;
                        return (
                          <button
                            key={muestra.id}
                            type="button"
                            onClick={() => handleCargarMuestra(muestra)}
                            disabled={Boolean(cargandoMuestra) || procesando}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--color-bg-main)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors border-b border-[var(--color-border)] last:border-b-0"
                          >
                            <span className="w-8 h-8 rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center flex-shrink-0">
                              {cargando ? (
                                <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                              ) : (
                                <FileText className="w-4 h-4" strokeWidth={1.75} />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-[var(--color-text)] truncate">
                                {muestra.etiqueta}
                              </span>
                              <span className="block text-[10px] text-[var(--color-text-muted)] truncate">
                                {muestra.detalle}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] rounded-xl p-6 text-center transition-all bg-[var(--color-bg-main)] relative group">
                <input
                  ref={fileInputRef}
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
                      alt="Previsualización del documento"
                      className="max-h-64 mx-auto rounded-lg shadow-sm border border-[var(--color-border)] object-contain"
                    />
                    <p className="text-xs text-[var(--color-success)] font-medium flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {archivo?.name} ({((archivo?.size || 0) / 1024).toFixed(0)} KB)
                    </p>
                  </div>
                ) : archivo ? (
                  <div className="space-y-2 py-4">
                    <FileText
                      className="w-12 h-12 text-[var(--color-accent)] mx-auto"
                      strokeWidth={1.75}
                    />
                    <p className="text-sm font-medium text-[var(--color-text)]">{archivo.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Documento PDF cargado</p>
                  </div>
                ) : (
                  <div className="space-y-3 py-6">
                    <div className="w-12 h-12 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto group-hover:scale-105 transition-transform">
                      <Camera className="w-6 h-6" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">
                        Tome una foto o cargue el archivo
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        Haga clic para examinar o arrastrar el documento
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleProcesarConVision}
                disabled={!archivo || procesando || bovedaBloqueada || faltaRepositorio}
                className="w-full py-3 px-4 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all"
              >
                {procesando ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" strokeWidth={1.75} />
                    Analizando documento con IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" strokeWidth={1.75} />
                    {modo === 'boveda' ? 'Analizar para Bóveda Documental' : 'Analizar para Radicación PQRS'}
                  </>
                )}
              </button>

              {modo === 'boveda' && faltaRepositorio && (
                <p className="text-[11px] text-[var(--color-text-muted)] text-center">
                  Selecciona un repositorio destino en el panel de metadatos para habilitar el
                  análisis.
                </p>
              )}
            </div>

            {resultadoVision && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4 shadow-[var(--shadow-card)]">
                <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.75} />
                  Resultado del análisis
                </h3>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--color-text-muted)]">Confianza de extracción</span>
                    <span
                      className={`font-bold tabular-nums ${
                        scoreConfianza >= 0.85
                          ? 'text-[var(--color-success)]'
                          : 'text-amber-500'
                      }`}
                    >
                      {(scoreConfianza * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-[var(--color-bg-main)] border border-[var(--color-border)] h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        scoreConfianza >= 0.85 ? 'bg-[var(--color-success)]' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(Math.max(scoreConfianza * 100, 0), 100)}%` }}
                    />
                  </div>
                </div>

                {resultadoVision.requiere_revision_humana && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-[var(--color-text)] flex items-start gap-2">
                    <AlertTriangle
                      className="w-4 h-4 shrink-0 mt-0.5 text-amber-500"
                      strokeWidth={1.75}
                    />
                    <span>
                      <strong>Revisión recomendada:</strong> la confianza es inferior al 85% o
                      existen campos ambiguos. Verifica los datos antes de guardar o radicar.
                    </span>
                  </div>
                )}

                <div className="text-xs text-[var(--color-text-muted)] pt-3 border-t border-[var(--color-border)] space-y-1">
                  <p>
                    <strong className="text-[var(--color-text)]">Procesamiento:</strong>{' '}
                    {resultadoVision.es_plan_b
                      ? 'Extractor local de contingencia'
                      : resultadoVision.modelo_utilizado || 'IA multimodal'}
                  </p>
                  <p className="truncate" title={resultadoVision.archivo?.nombre || archivo?.name}>
                    <strong className="text-[var(--color-text)]">Archivo:</strong>{' '}
                    {resultadoVision.archivo?.nombre || archivo?.name || 'Documento'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Columna derecha: destino */}
          <div className="lg:col-span-7">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 sm:p-8 space-y-6 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
                <h2 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                  {modo === 'boveda' ? (
                    <Database
                      className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <ShieldCheck
                      className="w-5 h-5 text-[var(--color-success)] flex-shrink-0"
                      strokeWidth={1.75}
                    />
                  )}
                  {modo === 'boveda'
                    ? '2. Metadatos e Indexación en Bóveda'
                    : '2. Verificación y Radicación PQRS'}
                </h2>
                {resultadoVision && (
                  <span className="hidden sm:inline-flex text-xs px-2.5 py-1 bg-[var(--color-bg-main)] border border-[var(--color-border)] text-[var(--color-text-muted)] rounded-md">
                    Campos extraídos por IA
                  </span>
                )}
              </div>

              {modo === 'boveda' ? (
                indexadoExitoso ? (
                  <div className="bg-[var(--color-bg-main)] border border-[var(--color-border)] rounded-xl p-6 text-center space-y-5 animate-scaleUp">
                    <div className="w-16 h-16 bg-[var(--color-accent-soft)] text-[var(--color-success)] rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-10 h-10" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-[var(--color-text)]">
                        Documento indexado en la Bóveda
                      </h3>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        El documento ya está disponible para búsquedas semánticas y consultas RAG.
                      </p>
                    </div>

                    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 text-left space-y-3 text-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <span className="text-[var(--color-text-muted)] text-xs">Documento</span>
                        <span className="font-semibold text-[var(--color-text)] break-words sm:text-right">
                          {indexadoExitoso.documento?.nombre_archivo ||
                            camposBoveda.titulo_sugerido ||
                            'Documento digitalizado'}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <span className="text-[var(--color-text-muted)] text-xs">
                          Repositorio destino
                        </span>
                        <span className="font-semibold text-[var(--color-accent)] break-words sm:text-right">
                          {indexadoExitoso.repositorioNombre}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pt-2 border-t border-[var(--color-border)]">
                        <span className="text-[var(--color-text-muted)] text-xs">
                          Fragmentos indexados
                        </span>
                        <span className="font-bold tabular-nums text-[var(--color-success)]">
                          {indexadoExitoso.chunks}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/chat?repo=${indexadoExitoso.repositorioId}`)
                        }
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold rounded-xl shadow-sm active:scale-[0.98] transition-all"
                      >
                        <MessageSquare className="w-4 h-4" strokeWidth={1.75} />
                        Consultar en Copiloto RAG
                      </button>
                      <button
                        type="button"
                        onClick={resetEscanner}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-text)] text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Camera className="w-4 h-4" strokeWidth={1.75} />
                        Escanear otro documento
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleGuardarEIndexar} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="repo-destino" className={LABEL_CLASS}>
                        Repositorio destino *
                      </label>
                      <div className="relative">
                        <FolderOpen
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none"
                          strokeWidth={1.75}
                        />
                        <select
                          id="repo-destino"
                          required
                          value={camposBoveda.repositorio_id}
                          onChange={(e) =>
                            setCamposBoveda((prev) => ({
                              ...prev,
                              repositorio_id: e.target.value,
                            }))
                          }
                          disabled={cargandoRepos || repositorios.length === 0}
                          className={`${INPUT_CLASS} pl-9 cursor-pointer disabled:cursor-not-allowed`}
                        >
                          {repositorios.length === 0 ? (
                            <option value="">
                              {cargandoRepos ? 'Cargando repositorios...' : 'Sin repositorios disponibles'}
                            </option>
                          ) : (
                            repositorios.map((repo) => (
                              <option key={repo.id} value={repo.id}>
                                {repo.nombre} ({repo.departamento})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      {cargandoRepos && (
                        <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5">
                          <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={1.75} />
                          Cargando repositorios...
                        </p>
                      )}
                      {errorRepos && (
                        <p className="text-[11px] text-[var(--color-danger)]">{errorRepos}</p>
                      )}
                      {!cargandoRepos && !errorRepos && repositorios.length === 0 && (
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                          No hay repositorios disponibles.{' '}
                          <button
                            type="button"
                            onClick={() => navigate('/ingesta')}
                            className="font-semibold text-[var(--color-accent)] hover:underline"
                          >
                            Crea uno en Ingesta Documental
                          </button>
                          .
                        </p>
                      )}
                    </div>

                    {!resultadoVision ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-main)] p-8 text-center space-y-3">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto">
                          <Database className="w-6 h-6" strokeWidth={1.75} />
                        </div>
                        <p className="text-sm font-semibold text-[var(--color-text)]">
                          Metadatos pendientes de extracción
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] max-w-sm mx-auto">
                          Carga o captura un documento, selecciona el repositorio destino y analízalo
                          con IA para revisar el título, el tipo documental, el resumen y las
                          entidades clave antes de indexarlo.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label htmlFor="titulo-documento" className={LABEL_CLASS}>
                              Título del documento
                            </label>
                            <input
                              id="titulo-documento"
                              type="text"
                              required
                              value={camposBoveda.titulo_sugerido}
                              onChange={(e) =>
                                setCamposBoveda((prev) => ({
                                  ...prev,
                                  titulo_sugerido: e.target.value,
                                }))
                              }
                              placeholder="Ej. Contrato de prestación de servicios 2026"
                              className={INPUT_CLASS}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label htmlFor="tipo-documento" className={LABEL_CLASS}>
                              Tipo de documento
                            </label>
                            <select
                              id="tipo-documento"
                              value={camposBoveda.tipo_documento}
                              onChange={(e) =>
                                setCamposBoveda((prev) => ({
                                  ...prev,
                                  tipo_documento: e.target.value,
                                }))
                              }
                              className={`${INPUT_CLASS} cursor-pointer`}
                            >
                              {TIPOS_DOCUMENTO.map((tipo) => (
                                <option key={tipo} value={tipo}>
                                  {tipo}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="resumen-ejecutivo" className={LABEL_CLASS}>
                            Resumen ejecutivo
                          </label>
                          <textarea
                            id="resumen-ejecutivo"
                            rows={3}
                            value={camposBoveda.resumen_ejecutivo}
                            onChange={(e) =>
                              setCamposBoveda((prev) => ({
                                ...prev,
                                resumen_ejecutivo: e.target.value,
                              }))
                            }
                            placeholder="Resumen profesional del objeto y los datos relevantes del documento."
                            className={`${INPUT_CLASS} resize-y`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="texto-ocr" className={LABEL_CLASS}>
                            Texto OCR completo
                          </label>
                          <textarea
                            id="texto-ocr"
                            rows={6}
                            value={camposBoveda.texto_ocr_completo}
                            onChange={(e) =>
                              setCamposBoveda((prev) => ({
                                ...prev,
                                texto_ocr_completo: e.target.value,
                              }))
                            }
                            placeholder="Transcripción completa del documento. Puedes corregirla antes de indexar."
                            className={`${INPUT_CLASS} resize-y font-mono text-xs leading-relaxed`}
                          />
                          <p className="text-[11px] text-[var(--color-text-muted)]">
                            Este texto se fragmenta e indexa para consultas RAG.
                          </p>
                        </div>

                        <div className="pt-3 border-t border-[var(--color-border)] space-y-3">
                          <p className="text-xs font-semibold text-[var(--color-text)]">
                            Entidades clave detectadas
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label htmlFor="entidad-emisor" className="text-[11px] font-medium text-[var(--color-text-muted)]">
                                Emisor
                              </label>
                              <input
                                id="entidad-emisor"
                                type="text"
                                value={camposBoveda.entidades_clave.emisor}
                                onChange={(e) => actualizarEntidad('emisor', e.target.value)}
                                placeholder="Empresa o entidad emisora"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label htmlFor="entidad-receptor" className="text-[11px] font-medium text-[var(--color-text-muted)]">
                                Receptor
                              </label>
                              <input
                                id="entidad-receptor"
                                type="text"
                                value={camposBoveda.entidades_clave.receptor}
                                onChange={(e) => actualizarEntidad('receptor', e.target.value)}
                                placeholder="Empresa o persona destinataria"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label htmlFor="entidad-nit" className="text-[11px] font-medium text-[var(--color-text-muted)]">
                                NIT / Doc
                              </label>
                              <input
                                id="entidad-nit"
                                type="text"
                                value={camposBoveda.entidades_clave.documento_id_o_nit}
                                onChange={(e) =>
                                  actualizarEntidad('documento_id_o_nit', e.target.value)
                                }
                                placeholder="NIT, cédula o radicado"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label htmlFor="entidad-fecha" className="text-[11px] font-medium text-[var(--color-text-muted)]">
                                Fecha
                              </label>
                              <input
                                id="entidad-fecha"
                                type="text"
                                value={camposBoveda.entidades_clave.fecha_documento}
                                onChange={(e) =>
                                  actualizarEntidad('fecha_documento', e.target.value)
                                }
                                placeholder="AAAA-MM-DD"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <label htmlFor="entidad-monto" className="text-[11px] font-medium text-[var(--color-text-muted)]">
                                Monto
                              </label>
                              <input
                                id="entidad-monto"
                                type="text"
                                value={camposBoveda.entidades_clave.monto_total}
                                onChange={(e) => actualizarEntidad('monto_total', e.target.value)}
                                placeholder="Valor total con moneda"
                                className={INPUT_CLASS}
                              />
                            </div>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={indexando || !camposBoveda.repositorio_id}
                          className="w-full py-3.5 px-4 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all mt-2"
                        >
                          {indexando ? (
                            <>
                              <RefreshCw className="w-5 h-5 animate-spin" strokeWidth={1.75} />
                              Indexando documento...
                            </>
                          ) : (
                            <>
                              <Save className="w-5 h-5" strokeWidth={1.75} />
                              Guardar e Indexar en Bóveda
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </form>
                )
              ) : radicadoExitoso ? (
                <div className="bg-[var(--color-bg-main)] border border-[var(--color-border)] rounded-xl p-6 text-center space-y-5 animate-scaleUp">
                  <div className="w-16 h-16 bg-[var(--color-accent-soft)] text-[var(--color-success)] rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[var(--color-text)]">
                      Caso PQRS radicado con éxito
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                      El caso fue registrado y asignado al área responsable para su gestión.
                    </p>
                  </div>

                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 text-left space-y-3 font-mono text-sm">
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-[var(--color-text-muted)] text-xs">Número de radicado</span>
                      <span className="text-[var(--color-success)] font-bold">
                        {radicadoExitoso.ticket_id}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-[var(--color-text-muted)] text-xs">SLA máximo</span>
                      <span className="text-[var(--color-accent)] font-semibold">
                        {radicadoExitoso.sla_horas} horas corridas
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3 pt-2 border-t border-[var(--color-border)]">
                      <span className="text-[var(--color-text-muted)] text-xs">Token de consulta</span>
                      <button
                        type="button"
                        onClick={copiarToken}
                        className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text)] hover:text-[var(--color-accent)] bg-[var(--color-bg-main)] border border-[var(--color-border)] px-2.5 py-1 rounded-md transition-colors"
                      >
                        {copiado ? (
                          <Check className="w-3.5 h-3.5 text-[var(--color-success)]" strokeWidth={1.75} />
                        ) : (
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                        )}
                        {radicadoExitoso.tracking_token
                          ? `${radicadoExitoso.tracking_token.slice(0, 12)}...`
                          : 'N/A'}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetEscanner}
                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[var(--color-bg-main)] border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-text)] rounded-xl text-sm font-semibold transition-colors"
                  >
                    <Camera className="w-4 h-4" strokeWidth={1.75} />
                    Escanear otro documento
                  </button>
                </div>
              ) : (
                <form onSubmit={handleConfirmarYRadicar} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Nombre del solicitante</label>
                      <input
                        type="text"
                        required
                        value={camposEditados.nombre_solicitante}
                        onChange={(e) =>
                          setCamposEditados({
                            ...camposEditados,
                            nombre_solicitante: e.target.value,
                          })
                        }
                        placeholder="Ej. Juan Pérez"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Correo electrónico</label>
                      <input
                        type="email"
                        required
                        value={camposEditados.email_solicitante}
                        onChange={(e) =>
                          setCamposEditados({
                            ...camposEditados,
                            email_solicitante: e.target.value,
                          })
                        }
                        placeholder="correo@ejemplo.com"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Teléfono</label>
                      <input
                        type="text"
                        value={camposEditados.telefono_solicitante}
                        onChange={(e) =>
                          setCamposEditados({
                            ...camposEditados,
                            telefono_solicitante: e.target.value,
                          })
                        }
                        placeholder="3001234567"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Tipo de solicitud</label>
                      <select
                        value={camposEditados.tipo_solicitud}
                        onChange={(e) =>
                          setCamposEditados({
                            ...camposEditados,
                            tipo_solicitud: e.target.value,
                          })
                        }
                        className={`${INPUT_CLASS} cursor-pointer`}
                      >
                        <option value="Petición">Petición</option>
                        <option value="Queja">Queja</option>
                        <option value="Reclamo">Reclamo</option>
                        <option value="Soporte Técnico">Soporte Técnico</option>
                        <option value="Sugerencia">Sugerencia</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Prioridad</label>
                      <select
                        value={camposEditados.prioridad_sugerida}
                        onChange={(e) =>
                          setCamposEditados({
                            ...camposEditados,
                            prioridad_sugerida: e.target.value,
                          })
                        }
                        className={`${INPUT_CLASS} cursor-pointer`}
                      >
                        <option value="Baja">Baja (48h)</option>
                        <option value="Media">Media (24h)</option>
                        <option value="Alta">Alta (4h)</option>
                        <option value="Crítica">Crítica (2h)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Departamento asignado</label>
                    <select
                      value={camposEditados.area_sugerida}
                      onChange={(e) =>
                        setCamposEditados({
                          ...camposEditados,
                          area_sugerida: e.target.value,
                        })
                      }
                      className={`${INPUT_CLASS} cursor-pointer`}
                    >
                      <option value="Soporte Técnico y Sistemas">Soporte Técnico y Sistemas</option>
                      <option value="Facturación y Cobranzas">Facturación y Cobranzas</option>
                      <option value="Control de Calidad y Garantías">
                        Control de Calidad y Garantías
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Asunto</label>
                    <input
                      type="text"
                      required
                      value={camposEditados.asunto}
                      onChange={(e) =>
                        setCamposEditados({ ...camposEditados, asunto: e.target.value })
                      }
                      placeholder="Resumen del requerimiento"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div>
                        <label htmlFor="descripcion-extraida" className={LABEL_CLASS}>
                          Descripción extraída del documento
                        </label>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                          Texto transcrito por la IA. Verifica que sea claro y completo; puedes
                          editarlo antes de radicar.
                        </p>
                      </div>
                      {mostrarLimpiarFormato && (
                        <button
                          type="button"
                          onClick={handleLimpiarFormato}
                          title="Elimina frases repetidas y normaliza los espacios"
                          className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg bg-[var(--color-accent-soft)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors flex-shrink-0"
                        >
                          <Wand2 className="w-3.5 h-3.5" strokeWidth={1.75} />
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
                      onChange={(e) =>
                        setCamposEditados({ ...camposEditados, descripcion: e.target.value })
                      }
                      placeholder="Ej. El usuario reporta fallas de conectividad desde el 12 de mayo y solicita revisión del servicio..."
                      className={`${INPUT_CLASS} resize-y`}
                    />

                    <div
                      id="descripcion-ayuda"
                      className="rounded-lg bg-[var(--color-bg-main)] border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-muted)] leading-relaxed"
                    >
                      <span className="font-semibold text-[var(--color-text)]">Vista legible: </span>
                      {descripcionLegible ||
                        'Aún no hay una descripción extraída. Carga un documento o procesa un formulario para verla aquí.'}
                      {mostrarLimpiarFormato && (
                        <span className="block mt-1 text-amber-500">
                          Se detectó texto repetido o espacios innecesarios. Usa «Limpiar formato»
                          para normalizar la descripción.
                        </span>
                      )}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-[var(--color-text)] bg-[var(--color-bg-main)] border border-[var(--color-border)] rounded-xl p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autorizacionDatos}
                      onChange={(e) => setAutorizacionDatos(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent)] flex-shrink-0"
                    />
                    <span>
                      Autorizo el tratamiento de mis datos personales conforme a la{' '}
                      <strong>Ley 1581 de 2012</strong> y la política de privacidad de la entidad.
                    </span>
                  </label>

                  {resultadoVision?.requiere_revision_humana && (
                    <label className="flex items-start gap-2.5 text-xs text-[var(--color-text)] bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={revisionConfirmada}
                        onChange={(e) => setRevisionConfirmada(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-amber-500 flex-shrink-0"
                      />
                      <span>
                        Confirmo que he revisado y corregido manualmente los campos con confianza
                        menor al 85%.
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
                    className="w-full py-3.5 px-4 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all mt-4"
                  >
                    {radicando ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" strokeWidth={1.75} />
                        Radicando caso PQRS...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" strokeWidth={1.75} />
                        Confirmar y Radicar Caso PQRS
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
