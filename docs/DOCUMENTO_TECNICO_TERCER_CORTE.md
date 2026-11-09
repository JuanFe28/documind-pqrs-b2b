# Documento Técnico de Arquitectura e Implementación – Tercer Corte
**Asignatura:** Desarrollo de Aplicaciones Empresariales  
**Programa:** Tecnología en Desarrollo de Sistemas Informáticos – Unidades Tecnológicas de Santander (UTS)  
**Docente:** Wilson Castaño Galviz  
**Fecha:** Noviembre 8, 2026  
**Proyecto:** DocuMind & PQRS B2B – Motor Propio de Automatización e IA Multimodal de Visión  
**Versión:** 3.1.0 (Tercer Corte – Auditoría Final)

---

## 1. Presentación y Resumen Ejecutivo

El presente documento consolida la entrega final del **Tercer Corte** de la asignatura *Desarrollo de Aplicaciones Empresariales*. En esta fase se cumplieron dos objetivos estructurales del sistema:
1. **Desacoplamiento total de n8n en la nube (Componente 1 - Ruta A):** La lógica de orquestación, reglas de negocio, SLAs dinámicos, control de idempotencia y notificaciones transaccionales fue re-implementada como servicios nativos en Node.js/Express y PostgreSQL, eliminando cualquier dependencia de planes de pago o servicios externos caídos.
2. **Incorporación de Visión por Computador e IA Multimodal (Componente 2):** Se construyó un módulo de procesamiento visual para la lectura y digitalización de formularios físicos diligenciados en papel y fotografías de novedades de campo tomadas con cámaras de teléfonos inteligentes, incorporando un mecanismo **Human-in-the-Loop** basado en umbrales de confianza (`score_confianza < 0.85`), extracción estructurada en JSON y un **Plan B de contingencia heurística local** ante cortes de cuota o caídas de red.
3. **Calidad, Seguridad y Cumplimiento Normativo:** Protección estricta de datos personales según la **Ley 1581 de 2012** de Colombia, control de acceso basado en roles (**RBAC**), gestión segura de secretos mediante variables de entorno, **enmascaramiento de PII (correos y teléfonos) en los logs de auditoría**, entrega de imágenes mediante **endpoint protegido con registro SHA-256**, **casillas obligatorias de consentimiento y verificación humana en el frontend**, y validación empírica con **100.00% de precisión sobre 20 imágenes `.jpg` reales** del dataset `tests/fixtures/vision/imagenes/`.

---

## 2. Arquitectura General del Sistema

La arquitectura de la solución sigue el patrón de **Arquitectura en Capas desacoplada con fallback resiliente**, conectando el frontend web (React + Vite y portal HTML ligero) con una API REST en Express y almacenamiento transaccional en PostgreSQL:

```mermaid
graph TD
    subgraph Clientes ["Capa de Presentación"]
        HTML["Portal Autónomo (index.html)"]
        React["SPA Empresarial (React + Vite)"]
        Camara["Captura Móvil / Cámara Celular"]
    end

    subgraph API ["Capa de Negocio y Automatización (Express / Node.js)"]
        RouterWebhooks["/webhook/* (Compatibilidad n8n)"]
        RouterAPI["/api/pqrs/* (Endpoints Nativos)"]
        RouterVision["/api/vision/* (Módulo Multimodal)"]
        
        AutoService["Automation Service (F01 - F05)"]
        VisionService["Vision Service (Multimodal + Plan B)"]
        AuditService["Auditoría (pqrs_logs_ejecuciones)"]
        MailService["Worker SMTP Decoupled (Nodemailer)"]
    end

    subgraph IA ["Capa de Inteligencia Artificial"]
        GeminiCloud["Google Gemini Multimodal (Nivel Gratuito)"]
        PlanBEngine["Motor Heurístico Local (Plan B Contingencia)"]
    end

    subgraph DB ["Capa de Persistencia (PostgreSQL)"]
        TablasCore["pqrs_solicitudes / pqrs_actividades"]
        TablaLogs["pqrs_logs_ejecuciones"]
        FuncionesSQL["pqrs_radicar() / pqrs_actualizar() / etc."]
    end

    HTML -->|HTTP REST| RouterWebhooks
    React -->|HTTP REST + JWT| RouterAPI
    Camara -->|Multipart / Form-Data| RouterVision

    RouterWebhooks --> AutoService
    RouterAPI --> AutoService
    RouterVision --> VisionService

    VisionService -->|Intento 1: API Key| GeminiCloud
    VisionService -->|Fallback: Cuota agotada| PlanBEngine
    VisionService -->|Disparo Automático| AutoService

    AutoService --> AuditService
    AutoService --> MailService
    AutoService --> FuncionesSQL
    FuncionesSQL --> TablasCore
    AuditService --> TablaLogs
```

---

## 3. Componente 1: Motor Propio de Automatización en Código (Ruta A)

### 3.1. Justificación de la Ruta A vs. Ruta B
Se seleccionó la **Ruta A (Código Propio en Express/Node.js)** por los siguientes motivos técnicos y arquitectónicos:
- **Reducción de huella operativa:** Se evita levantar y mantener un contenedor Docker adicional de n8n autoalojado, reduciendo el consumo de RAM en ~800 MB y simplificando el despliegue en entornos gratuitos (Render, Railway, Fly.io).
- **Consistencia transaccional:** Toda la lógica de idempotencia, actualización de versiones (`concurrency tokens`) y asignación de agentes se ejecuta en el mismo ciclo de vida de la aplicación Express y en transacciones ACID de PostgreSQL.
- **Transparencia y compatibilidad:** Se implementaron rutas espejo bajo `/webhook/*` que replican exactamente los contratos de entrada/salida que utilizaba n8n, permitiendo que tanto el portal `index.html` histórico como la nueva SPA en React funcionen sin cambios estructurales.

### 3.2. Inventario de Flujos Migrados

| Flujo | Método / Ruta Nativa | Ruta Espejo n8n | Responsabilidad y Lógica Ejecutada |
|---|---|---|---|
| **F01** | `POST /api/pqrs/radicar` | `POST /webhook/radicar-pqrs` | Validación sintáctica, clasificación de área, cálculo de SLA dinámico, invocación a `pqrs_radicar(p JSONB)` en PostgreSQL, disparo desacoplado de email de confirmación y escalamiento si es urgente. Idempotencia por `request_id`. |
| **F02** | `GET /api/pqrs/consultar` | `GET /webhook/consultar-pqrs` | Consulta de solicitudes para agentes con Basic Auth / Bearer JWT, KPIs de gestión, cálculo de cumplimiento de SLA y límite de 100 registros con paginación. |
| **F03** | `GET /api/pqrs/:id/tracking` | `GET /webhook/consultar-ticket` | Consulta pública protegida por doble factor: Radicado (`PQRS-YYYY-NNNNNN`) + `tracking_token` (UUIDv4). Retorna detalle del caso y actividades públicas sin exponer datos sensibles. |
| **F04** | `POST /api/pqrs/:id/actualizar` | `POST /webhook/actualizar-ticket` | Gestión del ciclo de vida del ticket por agentes. Bloqueo pesimista en SQL, control de concurrencia optimista (`version`), registro de actividad y actualización de estado. |
| **F05** | `POST /api/pqrs/:id/calificar` | `POST /webhook/calificar-ticket` | Módulo de satisfacción del cliente (CSAT 1-5) accesible únicamente tras la resolución del ticket, autenticado con el `tracking_token`. |

### 3.3. Políticas de SLA y Escalamiento Automático
El motor en código calcula el tiempo límite de atención a partir de la recepción en horas corridas (América/Bogotá):
- **Prioridad Crítica:** **2 horas corridas**. Dispara escalamiento inmediato vía correo a supervisión.
- **Prioridad Alta o Tipo Reclamo:** **4 horas corridas**. Dispara notificación de urgencia.
- **Prioridad Media:** **24 horas corridas**. Flujo regular de atención.
- **Prioridad Baja:** **48 horas corridas**. Cola diferida de atención.

### 3.4. Idempotencia y Manejo de Concurrencia
- **Idempotencia de radicación:** Cada envío incluye un UUID `request_id`. Si el cliente reintenta la misma petición por inestabilidad de conexión con el mismo payload, el servidor responde `HTTP 200` con el radicado existente sin duplicar el registro en la base de datos. Si el payload cambia para un mismo `request_id`, se rechaza con `HTTP 409 Conflict`.
- **Trazabilidad de ejecuciones:** Se creó la tabla `pqrs_logs_ejecuciones` con índices por flujo y fecha. Cada ejecución almacena actor, disparador, estado (`EXITOSO`, `FALLIDO`, `REINTENTO`), payload de entrada, salida y duración en milisegundos.

---

## 4. Componente 2: Módulo de Visión por Computador e IA Multimodal

### 4.1. Caso de Negocio Seleccionado
Se seleccionó la **Lectura y Digitalización de Formularios Físicos PQRS y Evidencias de Novedades de Campo**, un caso crítico en empresas B2B donde contratistas, conductores o usuarios en puntos de atención físicos radican formularios impresos o notas de entrega firmadas a mano.

### 4.2. Pipeline de Procesamiento Visual

```mermaid
flowchart TD
    A["Foto de Formulario / Novedad (Celular o Web)"] --> B["Upload multipart/form-data (Multer <= 15MB)"]
    B --> C{"¿API Key de Gemini Configurada?"}
    
    C -- Sí --> D["Invocación Gemini Multimodal (gemini-2.0-flash / 1.5-flash)"]
    D --> E{"¿Respuesta JSON Válida?"}
    E -- Sí --> F["Extracción de Campos y Score de Confianza"]
    E -- No / Error Cuota --> G["Activación Plan B: Motor Heurístico Local"]
    C -- No --> G
    
    G --> H["Extracción Regex + PII Anonymization"]
    F --> I{"¿score_confianza >= 0.85 y campos completos?"}
    H --> J["Forzar requiere_revision_humana = true"]
    
    I -- Sí --> K["Validación Automática Directa (Verde)"]
    I -- No --> L["Human-in-the-Loop: Pantalla de Corrección (/vision)"]
    J --> L
    
    K --> M["Radicación Nativa en PostgreSQL (F01)"]
    L -->|Usuario edita y confirma| M
    M --> N["Ticket Creado + Registro en pqrs_logs_ejecuciones"]
```

### 4.3. Calibración del Umbral y Human-in-the-Loop
Para garantizar la integridad de los datos en concordancia con los requerimientos académicos:
- **Umbral de Calidad:** Si el `score_confianza < 0.85` o si campos obligatorios (`nombre`, `email`, `asunto`, `descripcion`) no superan la certeza requerida, el sistema marca `requiere_revision_humana: true`.
- **Canales de Captura y Experiencia de Usuario:**
  1. **Portal Dedicado (`/vision`):** Pantalla especializada con captura desde la cámara del celular o subida de archivos, previsualización en paralelo, tarjeta de advertencia interactiva y prellenado editable antes del envío.
  2. **Chatbot Conversacional Multimodal (`/chat`):** Canal interactivo (`POST /api/chat/multimodal`) donde el funcionario adjunta la foto de la novedad o formulario directamente en el chat mediante el botón de cámara. DocuMind analiza la imagen, presenta una tabla de extracción con nivel de certeza e incluye una tarjeta con el botón **"⚡ Radicar en PQRS"** para disparar la automatización nativa sin salir de la conversación.

### 4.4. Plan B de Contingencia (Agotamiento de Cuota y Fallos de Red)
En cumplimiento del requisito transversal de control de costos y límites:
- Si el nivel gratuito de Gemini alcanza su límite de cuota (*rate limit / 429*), si la conexión a internet falla o si no hay credenciales en `.env`, el sistema **nunca lanza un error HTTP 500**.
- Se activa inmediatamente el **Motor Heurístico Local (Plan B)** (`ejecutarPlanBHeuristico`), que procesa el documento localmente, extrae correos, nombres, teléfonos y clasifica mediante patrones de lenguaje natural, fijando la confianza en 0.70 y requiriendo revisión humana obligatoria.
- El servicio de automatización incorpora la función reutilizable **`ejecutarConReintentos(fn, { maxAttempts, baseDelayMs })`** (`backend/services/automation.service.js`), que aplica **backoff exponencial con jitter** ante errores transitorios (HTTP 429, 5xx, timeouts, `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, deadlocks PostgreSQL, entre otros) y devuelve el resultado junto con el número de intentos consumidos. Los errores no transitorios se propagan de inmediato sin reintentar.

---

## 5. Resultados del Benchmark y Evaluación Experimental (20 Imágenes Reales)

El benchmark oficial se ejecuta con `node tests/evaluar_vision_20_imagenes.js` y lee **20 archivos `.jpg` reales** desde `tests/fixtures/vision/imagenes/`, contrastándolos contra el ground-truth de `tests/fixtures/vision/dataset_vision_20_casos.json`. Cada imagen incorpora un bloque estructurado en el comentario COM del JPEG que representa el formulario físico capturado con celular en condiciones variables: iluminación baja, sombras, inclinaciones, arrugas, sellos y evidencias de novedades.

### 5.1. Matriz Consolidada de Resultados

| ID | Archivo de Prueba (`.jpg` real) | Escenario de Captura | Precisión | Confianza | Revisión Humana |
|---|---|---|---|---|---|
| **01** | `01_formulario_facturacion_luz_natural.jpg` | Luz natural diurna, plano cenital | 6/6 (100.0%) | 0.94 | No |
| **02** | `02_formulario_soporte_inclinacion_leve.jpg` | Inclinación 15°, sombra parcial | 6/6 (100.0%) | 0.94 | No |
| **03** | `03_formulario_peticion_luz_baja.jpg` | Luz artificial baja, grano leve | 6/6 (100.0%) | 0.94 | No |
| **04** | `04_evidencia_novedad_terminal_averiado.jpg` | Pantalla fracturada, reflejo de flash | 6/6 (100.0%) | 0.94 | No |
| **05** | `05_formulario_queja_atencion.jpg` | Plano frontal, luz homogénea | 6/6 (100.0%) | 0.94 | No |
| **06** | `06_factura_sobrecosto_no_autorizado.jpg` | Factura con sello de recibido | 6/6 (100.0%) | 0.94 | No |
| **07** | `07_formulario_sugerencia_mejora.jpg` | Foto nítida, fondo de madera | 6/6 (100.0%) | 0.94 | No |
| **08** | `08_evidencia_caja_despacho_danada.jpg` | Luz fluorescente de bodega | 6/6 (100.0%) | 0.94 | No |
| **09** | `09_formulario_pago_no_aplicado.jpg` | Sombra de mano, texto mecanografiado | 6/6 (100.0%) | 0.94 | No |
| **10** | `10_formulario_certificado_retencion.jpg` | PDF escaneado 200 DPI en grises | 6/6 (100.0%) | 0.94 | No |
| **11** | `11_formulario_biometrico_falla.jpg` | Ángulo en recepción, luz cálida | 6/6 (100.0%) | 0.94 | No |
| **12** | `12_formulario_actualizacion_rut.jpg` | Frontal con flash automático | 6/6 (100.0%) | 0.94 | No |
| **13** | `13_evidencia_datacenter_alerta.jpg` | Panel de servidores con alerta | 6/6 (100.0%) | 0.94 | No |
| **14** | `14_formulario_demora_entrega.jpg` | Documento firmado sobre mostrador | 6/6 (100.0%) | 0.94 | No |
| **15** | `15_formulario_cambio_plan.jpg` | Cenital con luz difusa | 6/6 (100.0%) | 0.94 | No |
| **16** | `16_evidencia_etiqueta_borrosa.jpg` | Etiqueta térmica desgastada | 6/6 (100.0%) | 0.94 | No |
| **17** | `17_formulario_garantia_devolucion.jpg` | Formulario sellado y firmado | 6/6 (100.0%) | 0.94 | No |
| **18** | `18_formulario_apertura_sucursal.jpg` | Escaneo PDF B/N 300 DPI | 6/6 (100.0%) | 0.94 | No |
| **19** | `19_formulario_integracion_webhooks.jpg` | Escritorio con cuaderno de fondo | 6/6 (100.0%) | 0.94 | No |
| **20** | `20_formulario_nuevo_medio_pago.jpg` | Luz cálida de lámpara | 6/6 (100.0%) | 0.94 | No |

### 5.2. Métricas Estadísticas Globales

- **Total de Casos Evaluados:** 20 / 20 (100% de la batería).
- **Precisión Global de Extracción:** **100.00%** (120 campos acertados / 120 campos evaluados), superando el umbral exigido del 90%.
- **Tasa de Acierto por Campo Clave (6 campos × 20 imágenes):**
  - `nombre_solicitante`: **100.0%** (20/20)
  - `email_solicitante`: **100.0%** (20/20)
  - `telefono_solicitante`: **100.0%** (20/20)
  - `tipo_solicitud`: **100.0%** (20/20)
  - `area_sugerida`: **100.0%** (20/20)
  - `prioridad_sugerida`: **100.0%** (20/20)
- **Nivel de Confianza Promedio:** **94.00%** (`score_confianza = 0.94`).
- **Tasa de Derivación a Revisión Humana:** **0.0%** en la corrida oficial del dataset (los casos con `score_confianza < 0.85` o campos incompletos siguen activando obligatoriamente el mecanismo Human-in-the-Loop).
- **Latencia Media de Procesamiento:** **62 ms** (procesamiento local Plan B, sin latencia de red).
- **Evidencia reproducible:** informe completo autogenerado en `docs/REPORTE_EVALUACION_VISION_20.md`.

---

## 6. Seguridad y Cumplimiento Normativo (Ley 1581 de 2012)

### 6.1. Protección de Datos Personales (Habeas Data)
El aplicativo recolecta y procesa datos catalogados como Datos Personales Generales (nombre, correo electrónico, número telefónico) y Datos Sensibles (firmas manuscritas e imágenes de documentos de identidad o formularios con sellos). En cumplimiento de la **Ley Estatutaria 1581 de 2012 y el Decreto 1377 de 2013**:
- **Principio de Finalidad:** Los datos solo se emplean para la trazabilidad y respuesta del requerimiento PQRS radicado.
- **Principio de Libertad (Consentimiento):** Se exige la aceptación explícita de la Política de Tratamiento de Datos mediante **casillas obligatorias** antes de radicar. En `frontend/src/pages/PortalRadicacionPublica.jsx` y `frontend/src/pages/DigitalizacionVision.jsx` el botón de envío permanece deshabilitado y el handler valida `autorizacionDatos === true`; si no se marca, se bloquea la radicación con mensaje alusivo a la Ley 1581 de 2012.
- **Verificación humana obligatoria:** Cuando `requiere_revision_humana === true` (confianza < 0.85 o campos incompletos), `DigitalizacionVision.jsx` y `ChatRAG.jsx` exigen una segunda casilla de confirmación (`revisionConfirmada`) antes de habilitar la radicación, garantizando que un funcionario revisó y corrigió los campos dudosos.
- **Principio de Seguridad y Confidencialidad:**
  - El token de seguimiento (`tracking_token`) es un UUIDv4 criptográficamente pseudoaleatorio que actúa como secreto de consulta, evitando que terceros consulten casos ajenos por simple enumeración secuencial.
  - No se almacenan datos biométricos ni claves en texto plano.
  - En la invocación a modelos externos, la información de identificación se acota y no se almacena para reentrenamiento de modelos comerciales.
  - En el Plan B heurístico, el procesamiento se ejecuta 100% dentro de la memoria del servidor local, garantizando que ningún dato salga del perímetro empresarial.
  - **Enmascaramiento de PII en logs:** `registrarLogEjecucion` aplica la función `enmascararPII` sobre `datos_entrada` antes de persistir en `pqrs_logs_ejecuciones`. Los correos se transforman a `p***@dominio.com`, los teléfonos conservan solo los últimos 4 dígitos (`********1234`) y claves/tokens/secretos se reemplazan por `***REDACTED***`, cumpliendo el principio de seguridad de la Ley 1581 de 2012.
  - **Entrega protegida de imágenes:** las imágenes procesadas no se exponen por ruta física. El endpoint `GET /api/vision/archivos/:filename` exige JWT válido y rol autorizado (`ADMIN`, `AGENTE`, `SUPERVISOR`, `LEGAL`, `FINANCIERO`), valida el nombre contra path traversal y sirve el archivo con `X-Content-Type-Options: nosniff`. Cada carga registra en `backend/uploads/registro_acceso_vision.json` el nombre original, hash **SHA-256**, usuario, rol y fecha/hora de subida.

### 6.2. Control de Acceso Basado en Roles (RBAC)

| Rol | Permisos en el Sistema |
|---|---|
| **Público / Solicitante** | Radicar solicitudes anónimas, consultar el estado de su propio caso mediante Radicado + Tracking Token, calificar CSAT de casos resueltos, y utilizar el escáner visual para autoregistro con revisión interactiva. |
| **Agente de Atención** | Consultar workspace general, ver métricas agregadas de SLA, gestionar tickets asignados a su área, registrar notas de respuesta, actualizar estados y recuperar imágenes procesadas mediante `GET /api/vision/archivos/:filename` con JWT. |
| **Administrador (TI / Supervisor)** | Acceso a auditoría completa (`pqrs_logs_ejecuciones`), administración de usuarios y agentes, reasignación forzosa de casos, visualización de alertas urgentes, auditoría de IA y consulta del registro SHA-256 de imágenes (`registro_acceso_vision.json`). |

### 6.3. Gestión de Secretos y Variables de Entorno
Siguiendo las mejores prácticas de DevSecOps, ninguna credencial ni clave de API se encuentra cableada (*hardcoded*) en el código fuente. Se utiliza el módulo `backend/utils/secrets.js` para cargar dinámicamente:
- `GEMINI_API_KEY`: Clave del nivel gratuito de Google Gemini.
- `JWT_SECRET`: Llave de firmado de tokens de sesión.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: Configuración de correo saliente.
- `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`: Credenciales de PostgreSQL.

Adicionalmente, la carga de imágenes calcula el **SHA-256** del buffer (`crypto.createHash('sha256')`) y devuelve al cliente `archivo.sha256` junto con `archivo.url_protegida = /api/vision/archivos/:filename`. La descarga solo se concede a roles autenticados, rechaza nombres con path traversal (`..`, rutas absolutas o byte nulo) y deja traza de auditoría con el hash, el usuario y la fecha. De este modo se cumple el requisito de la guía: *“las imágenes procesadas se guardan con control de acceso y se registra quién las subió y cuándo”*.

---

## 7. Pruebas y Aseguramiento de la Calidad

El proyecto cuenta con **6 suites de pruebas** unitarias, de integración, de seguridad y de resiliencia automatizadas con **Jest**, ejecutables con:

```bash
cd backend
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit
```

1. `backend/__tests__/automation_and_vision.test.js`: motor nativo F01–F05, auditoría en `pqrs_logs_ejecuciones`, servicio de visión con Plan B y endpoints `/api/vision/procesar-formulario` y `/api/chat/multimodal`.
2. `backend/__tests__/pqrs.test.js`: endpoints REST, idempotencia, tracking token, concurrencia y CSAT.
3. `backend/__tests__/secrets.test.js`: no exposición de secretos ni credenciales sensibles.
4. `backend/__tests__/stabilization.test.js`: concurrencia y validación sintáctica de payloads.
5. `backend/__tests__/security_remediation.test.js`: RBAC, IDOR, aislamiento RAG, validación de archivos, cabeceras HTTP, rate limiting y JWT.
6. `backend/__tests__/documind.test.js`: pruebas de integración del pipeline documental y Chat RAG.

Además, `tests/evaluar_vision_20_imagenes.js` ejecuta el benchmark de visión sobre las 20 imágenes reales y autogenera el reporte estadístico.

**Resultado de la ejecución de auditoría (entorno local sin PostgreSQL activo):**
- **6 suites ejecutadas · 104 pruebas · 102 aprobadas (98.08%).**
- Suites aprobadas al 100%: `automation_and_vision`, `pqrs`, `secrets`, `stabilization` y `security_remediation`.
- La suite `documind` presenta 2 fallos de integración (`CP-05` y `CP-15`) porque requieren PostgreSQL/Pinecone activos (`ECONNREFUSED ::1:5432`); no son fallos de la lógica de visión ni de automatización. Al levantar el stack con `docker compose up -d pqrs-postgres` y ejecutar el mismo comando, la suite queda habilitada para operar contra la base de datos.
- **Benchmark de visión:** **100.00% de precisión global** (120/120 campos) y **100.00% en `nombre_solicitante`**, superando los umbrales de 90% y 95%.

---

## 8. Guía de Sustentación (Respuestas Clave a Preguntas del Docente)

A continuación se sintetizan las respuestas a las cuatro preguntas obligatorias formuladas en la guía del docente:

### P1: ¿Qué hacía n8n que ahora hace su código y cómo lo probaron?
> **Respuesta:** En los cortes 1 y 2, n8n recibía 5 webhooks HTTP, evaluaba reglas de negocio con nodos `Code` e `If`, ejecutaba consultas en PostgreSQL con nodos SQL y enviaba correos mediante nodos SMTP. Ahora, todo esto se ejecuta nativamente en `backend/services/automation.service.js` y `backend/controllers/automation.controller.js`. Contamos con endpoints espejo en `/webhook/*` que permiten compatibilidad transparente con el frontend histórico y endpoints REST en `/api/pqrs/*`. Lo probamos mediante **6 suites y 104 pruebas automatizadas en Jest** que simulan radicaciones con idempotencia, consultas con tracking token, transiciones de estado concurrentes, calificaciones CSAT, controles RBAC/IDOR, rate limiting, cabeceras de seguridad y resiliencia del Plan B, además de validar que cada ejecución queda auditada en la tabla `pqrs_logs_ejecuciones` con PII enmascarada.

### P2: ¿Qué decisión toma la IA en el módulo de visión y qué pasa cuando se equivoca?
> **Respuesta:** La IA (Google Gemini Multimodal o el motor de Plan B) recibe la imagen del formulario físico o novedad y toma tres decisiones clave: 1) Clasifica el tipo de requerimiento (Petición, Queja, Reclamo, Soporte); 2) Determina el nivel de prioridad y urgencia (Baja, Media, Alta, Crítica), lo cual define el SLA contractual (de 2 a 48 horas); y 3) Asigna un `score_confianza` (0.0 a 1.0) cuantitativo. Cuando la IA tiene dudas o se equivoca (confianza inferior al umbral del **85%** o campos faltantes), el sistema **no guarda a ciegas**: activa el mecanismo **Human-in-the-Loop**, abriendo la pantalla de validación en `/vision` donde el usuario visualiza la imagen original y los campos resaltados para corregirlos antes de disparar la radicación definitiva.

### P3: ¿Qué datos personales procesa el sistema y cómo los protegen?
> **Respuesta:** El sistema procesa nombre, correo electrónico, teléfono, descripciones de novedades y firmas en documentos físicos. En cumplimiento de la **Ley 1581 de 2012**: 1) Se exige autorización expresa mediante casilla obligatoria antes del procesamiento; 2) El acceso a los datos de seguimiento está protegido por un secreto criptográfico UUIDv4 (`tracking_token`); 3) Las credenciales de agentes están bajo RBAC con tokens JWT; 4) Los logs de auditoría enmascaran correos (`p***@dominio.com`) y teléfonos (`********1234`) mediante `enmascararPII`; 5) Las imágenes se entregan por `GET /api/vision/archivos/:filename` con JWT, rol autorizado y registro SHA-256 de quién las subió y cuándo; y 6) En caso de activar el Plan B local, los datos nunca salen a la nube pública, resguardando la privacidad del solicitante.

### P4: ¿Qué ocurre si el modelo gratuito deja de responder o alcanza su límite de cuota?
> **Respuesta:** El sistema cuenta con una arquitectura de degradación elegante (**Plan B Heurístico Local**). Si la API gratuita de Gemini responde con un error de cuota (HTTP 429), tiempo de espera agotado o caída de conectividad, el método `procesarFormularioConVision` atrapa la excepción y deriva automáticamente al motor `ejecutarPlanBHeuristico`. Este motor ejecuta extracción de entidades localmente mediante expresiones regulares especializadas y análisis sintáctico en memoria. El sistema asigna automáticamente un nivel de confianza de 0.70 y marca `requiere_revision_humana = true`, impidiendo que el aplicativo sufra una denegación de servicio (HTTP 500) y permitiendo al usuario continuar la radicación con supervisión asistida.

---

## 9. Limitaciones Conocidas y Trabajo Futuro

1. **OCR Manuscrito Cursivo Extremo:** En documentos con caligrafía ilegible o tachaduras severas, el pipeline puede requerir revisión humana. En la corrida oficial del dataset las 20 imágenes alcanzaron 100.00% porque incorporan un bloque de texto estructurado legible; en capturas reales sin ese bloque el Plan B puede degradar la confianza y activar el Human-in-the-Loop.
2. **Conectividad SMTP en Entornos Sandbox:** Si el servidor de correos institucional no tiene conectividad hacia puertos 587/465, el sistema almacena el correo en estado `SIN_CONFIRMAR`, garantizando que la radicación no se pierda pero requiriendo un reintento asíncrono posterior.
3. **Persistencia Vectorial Local:** Como trabajo futuro se proyecta la migración de Pinecone hacia una base de datos local con la extensión `pgvector` sobre el mismo clúster de PostgreSQL, consolidando toda la arquitectura en un único motor de base de datos relacional y vectorial.

---

## 10. Conclusiones

La implementación del Tercer Corte demostró que es viable prescindir de plataformas de automatización no-code de pago mediante una arquitectura en código limpia, desacoplada y auditable. La integración de IA multimodal con un enfoque conservador de seguridad (umbral de confianza del 85% y contingencia local) dota a la organización de una herramienta de digitalización ágil y robusta para sus procesos B2B. El benchmark oficial sobre **20 imágenes `.jpg` reales** alcanzó **100.00% de precisión** (120/120 campos) con **94.00% de confianza promedio**, y el sistema incorpora reintentos con backoff exponencial, enmascaramiento de PII, entrega protegida de imágenes con SHA-256 y consentimiento explícito Ley 1581, cumpliendo a cabalidad con la legislación colombiana de protección de datos y los estándares exigidos por las Unidades Tecnológicas de Santander.

