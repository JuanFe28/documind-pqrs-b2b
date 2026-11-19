# DocuMind & PQRS B2B Enterprise — Guía Ejecutiva de Operación y Sustentación

Plataforma empresarial unificada para **Gestión Documental Inteligente (RAG + Visión Multimodal)** y **Mesa de Ayuda PQRS B2B** con motor propio de automatización en Node.js/Express (Ruta A), respaldo n8n + PostgreSQL 16 y **Recorrido Guiado interactivo de 5 pasos** integrado directamente en la interfaz web.

---

## 1. Arquitectura y Módulos del Sistema

| Módulo / Ruta | Propósito Operativo |
|---|---|
| **Portal Ciudadano & Tracking** (`/radicar`, y portal autónomo `index.html`) | Radicación con generación de `request_id` idempotente, política SLA automática (2h/4h/24h/48h), comprobante con `tracking_token` UUIDv4, deep-linking (`#token=...&id=...`) y encuesta CSAT de 1 a 5 estrellas. |
| **Workspace Agentes PQRS** (`/pqrs`, y vista Agente en `index.html`) | Franja de 5 KPIs ejecutivos (`Total`, `Críticos`, `En Gestión`, `Cumplimiento SLA`, `Satisfacción CSAT`), filtros RBAC (`Todos`, `Mis Asignados`, `Mi Departamento`), gestión con concurrencia optimista (`version`), notas internas/públicas y exportación CSV neutralizada (`csvCell()`). |
| **Visión Multimodal** (`/vision`) | Digitalización de formularios físicos y evidencias con Gemini Vision + Plan B heurístico local (`score_confianza < 0.85` activa validación Human-in-the-Loop) y radicación directa en PQRS. |
| **Asistente RAG DocuMind** (`/chat`) | Consultas documentales con citas verificadas, comparación de contratos, circuito de falla rápido (`lastWorkingModel` + `AbortSignal.timeout(3000)` + warm-up `/api/documind/warmup`), y visión multimodal en chat. |
| **Ingesta & Dashboard TI** (`/ingesta`, `/dashboard`) | Carga de PDF/DOCX/TXT, indexación vectorial en Pinecone / búsqueda léxica en PostgreSQL y telemetría operativa del sistema. |
| **Automatización n8n / Express** (`/api/pqrs/*`, `/webhook/*`) | 5 flujos completos (`radicar-pqrs`, `consultar-pqrs`, `consultar-ticket`, `actualizar-ticket`, `calificar-ticket`) respaldados por 6 funciones PL/pgSQL y triggers duales en `database/init_db.sql`. |

---

## 2. Arranque Rápido y Credenciales de Prueba

### Arranque del Entorno Unificado (Windows)
```bat
.\iniciar_documind_pqrs.bat
```
Servicios expuestos:
- **Aplicación Principal (React + Vite):** `http://localhost:5173` (tema Claro Empresarial `#F8FAFC` con botón **Recorrido Guiado** y selector Claro/Oscuro).
- **Backend API REST (Express):** `http://localhost:5000/api/health`
- **Portal Autónomo HTML:** `index.html` (compatible con `:5000` Express o simulador local `node tests/servidor_simulador.js` en `:5678`).
- **Motor n8n & PostgreSQL 16:** `http://localhost:5678` y `localhost:5432` (`pqrs_db`).

### Credenciales de Evaluación

| Rol / Perfil | Correo / Usuario | Contraseña de Prueba | Acceso |
|---|---|---|---|
| **Administrador Global** | `admin@documind.com` | `admin2026*!` (o `password_seguro_uts`) | Plataforma completa + Dashboard TI |
| **Administrador Docente** | `wilson.admin@documind.com` | `admin2026*!` | Plataforma completa + Dashboard TI |
| **Agente Soporte** | `agente@documind.com` | `agente2026*!` | Bandeja PQRS, Ingesta y Chat RAG |
| **Legal / Financiero** | `diana.legal@documind.com` / `carlos.financiero@documind.com` | `legal2026*!` / `admin2026*!` | Repositorios departamentales RBAC |
| **Supervisor Workspace (`index.html` / Simulador)** | `andrea.silva` (`andrea.silva@techflow.co`) | `SupervisorSoporte2026*` | Workspace Agente (Supervisor Soporte) |

---

## 3. Flujo de los 5 Pasos de Negocio (Sustentación en Vivo)

1. **Entrada de Información:** Radicación desde `/radicar` (o plantilla rápida en `index.html`) generando `request_id` UUIDv4 para garantizar idempotencia ante reintentos.
2. **Procesamiento y Cálculo de SLA:** Normalización de tipología/prioridad (`Crítica` 2h, `Alta`/`Reclamo` 4h, `Media` 24h, `Baja` 48h) e inserción en PostgreSQL vía `pqrs_radicar(jsonb)`.
3. **Toma de Decisión y Acción Automática:** Detección de urgencia (`es_urgente = true`), despacho de notificaciones SMTP y entrega del comprobante con `tracking_token` privado.
4. **Almacenamiento PostgreSQL y Workspace RBAC:** Gestión operativa desde `/pqrs` o Workspace con filtros por departamento/asignación, incremento optimista de `version` y registro en `pqrs_actividades`.
5. **Rastreo del Cliente, CSAT e Inteligencia Documental (RAG):** Consulta pública segura (`#token=...&id=...`), calificación CSAT de 1 a 5 estrellas reflejada en KPIs y consulta/resolución asistida en `/chat` con respuesta en `< 1.5s`.

> El detalle interactivo de estos 5 pasos puede proyectarse directamente desde el botón **"Recorrido Guiado"** ubicado en la barra superior de la aplicación.

---

## 4. Documentación Técnica de Referencia (`docs/`)

| Documento | Contenido |
|---|---|
| [`docs/DOCUMENTO_TECNICO_TERCER_CORTE.md`](docs/DOCUMENTO_TECNICO_TERCER_CORTE.md) | Arquitectura Ruta A, Visión Multimodal, contratos y métricas técnicas. |
| [`docs/REPORTE_EVALUACION_VISION_20.md`](docs/REPORTE_EVALUACION_VISION_20.md) | Benchmark sobre 20 fotografías reales con umbral Human-in-the-Loop (`0.85`). |
| [`docs/ESTADO_PRODUCCION_ORACLE.md`](docs/ESTADO_PRODUCCION_ORACLE.md) | Estado de despliegue productivo en Oracle Cloud Always Free. |
| [`docs/MATRIZ_ACEPTACION_DOCUMIND.md`](docs/MATRIZ_ACEPTACION_DOCUMIND.md) | Criterios de aceptación UAT y seguridad. |
| [`STATUS_AUDIT.md`](STATUS_AUDIT.md) y [`ESTADO_ORQUESTACION.md`](ESTADO_ORQUESTACION.md) | Auditoría 360°, cierre de bugs (`BUG-001`..`BUG-005`) y registro de verificación final. |
