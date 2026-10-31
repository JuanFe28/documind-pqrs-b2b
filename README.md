# DocuMind & PQRS B2B Enterprise — Plataforma Unificada con Motor Propio de Automatización e IA Multimodal de Visión

Sistema empresarial integral que combina la **Gestión Documental Inteligente (DocuMind)** con la **Mesa de Ayuda y Automatización de PQRS B2B**, potenciado por modelos de lenguaje de última generación (**Google Gemini**), motor propio de automatización en Node.js/Express (Ruta A) y **Módulo de Visión por Computador e IA Multimodal** para digitalización de formularios físicos.

## 🎓 Tercer Corte: Entrega Completa (Motor Propio + Visión Multimodal)

- **Documento Técnico Oficial (Máx. 10 págs):** [`docs/DOCUMENTO_TECNICO_TERCER_CORTE.md`](docs/DOCUMENTO_TECNICO_TERCER_CORTE.md)
- **Reporte Estadístico del Benchmark (20 Imágenes):** [`docs/REPORTE_EVALUACION_VISION_20.md`](docs/REPORTE_EVALUACION_VISION_20.md)
- **Guía Académica Docente (Wilson Castaño Galviz):** [`docs/Guia_Tercer_Corte_Desarrollo_de_Aplicaciones_Empresariales.pdf`](docs/Guia_Tercer_Corte_Desarrollo_de_Aplicaciones_Empresariales.pdf)
- **Diseño Semana 1:** [PDF de dos páginas](docs/SEMANA_1_DISENO.pdf) y [fuente editable](docs/SEMANA_1_DISENO.md)

### Capacidades Desarrolladas en este Corte:
1. **Componente 1 (Automatización Propia en Código - Ruta A):** Reemplazo del 100% de n8n por servicios nativos en Node.js (`backend/services/automation.service.js`) para los 5 flujos empresariales (F01 a F05), con tabla de auditoría `pqrs_logs_ejecuciones`, SLAs dinámicos (2h a 48h) e idempotencia estricta por `request_id` y `operation_id`.
2. **Componente 2 (IA Multimodal de Visión & Human-in-the-Loop):** Procesamiento de fotos de formularios físicos y novedades tomadas con celular (`backend/services/vision.service.js`), extracción estructurada JSON y activación de revisión humana cuando `score_confianza < 0.85`.
3. **Plan B de Contingencia Local:** Degradación elegante mediante motor heurístico local que se activa ante agotamiento de cuota de IA o fallas de red, evitando caídas de servicio (HTTP 500).
4. **Benchmark Evaluado:** Batería automatizada sobre 20 imágenes reales (`node tests/evaluar_vision_20_imagenes.js`) con 78.33% de precisión estricta global y 88.00% de confianza promedio.
5. **Portal de Digitalización React:** Pantalla `/vision` con carga de fotos, prellenado interactivo y radicación nativa.

## Tercer corte: semana 1

Entrega de diseño: [PDF de dos páginas](docs/SEMANA_1_DISENO.pdf) y [fuente editable](docs/SEMANA_1_DISENO.md). Incluye inventario de los cinco flujos, elección de Ruta A, caso de visión y arquitectura propuesta. Diagnóstico del código y pendientes: [STATUS_AUDIT.md](STATUS_AUDIT.md).

La app muestra esos cuatro requisitos en **Semana 1 · Diseño**, disponible desde el login y el menú. La ruta `/semana-1` permite comparar arquitectura actual/propuesta y descargar el PDF, sin requerir conexión a los servicios de negocio. Para verla localmente:

```powershell
cd frontend
npm ci
npm run dev
# Abrir http://localhost:5173/semana-1
```

Esta vista presenta el entregable académico: identifica expresamente qué está en el código y qué está pendiente. No representa una migración ejecutada ni un módulo OCR operativo.

Validación del 29/10/2026: [prueba de escritorio automatizada](docs/PRUEBA_ESCRITORIO_SEMANA_1.md), con 24 comprobaciones aprobadas sobre la vista de semana 1 y su acceso desde el login. Incluye captura y resultados; el informe distingue estos controles de las integraciones aún no verificadas. La compilación con `npm run build` incluye el PDF como recurso del paquete.

Archivos vigentes: `index.html` es el portal autónomo PQRS de los cortes anteriores; `frontend/index.html` inicia la plataforma React; `workflow/n8n_workflow.json` es la exportación importable en n8n. Los dos archivos de `database/` son complementarios. Para regenerar el workflow: `node workflow/build_pqrs_workflow.js`.

La entrega de semana 1 es documental. La migración, OCR y despliegue descritos son trabajo futuro; las afirmaciones históricas del resto del README deben leerse junto con la auditoría, que distingue implementación de funcionamiento comprobado. No se ha verificado una conexión real con PostgreSQL, n8n, SMTP o proveedores de IA en esta revisión.

---

## 🏛️ 1. Visión General de la Plataforma

Este repositorio consolida en un único ecosistema empresarial dos módulos críticos de negocio:

1. **DocuMind (Gestión Documental & RAG Inteligente):**
   - Ingesta y clasificación automática de documentos empresariales (PDF, DOCX, TXT) con extracción inteligente de metadatos (categoría, resumen, entidad, fechas).
   - Base de conocimiento vectorial con **Pinecone** y generación aumentada por recuperación (**RAG**) con **Google Gemini**, permitiendo comparaciones exhaustivas entre repositorios y citas directas de fuentes.
   - Seguridad y aislamiento departamental por repositorios (Legal, Financiero, RRHH, etc.) mediante **Control de Acceso Basado en Roles (RBAC)** y tokens JWT.

2. **PQRS B2B & Mesa de Ayuda Automatizada:**
   - Portal web público de radicación ciudadana y seguimiento seguro mediante código de radicado único (`PQRS-YYYY-NNNNNN`) y token criptográfico UUIDv4.
   - Motor de flujos en **n8n** para clasificación, cálculo dinámico de SLAs (2h a 48h según severidad), alertas por correo SMTP al solicitante y supervisores.
   - Asignación inteligente a agentes operativos, registro de notas internas/públicas, control de versiones optimista y encuestas de satisfacción del cliente (**CSAT**).
   - **Asistente de Solución RAG con IA:** Integración directa que permite a los agentes operativos generar diagnósticos, planes de acción y propuestas de respuesta al cliente a partir del acervo documental de la organización.

---

## 🔒 2. Seguridad, Gestión de APIs y Secretos

> [!IMPORTANT]
> **Gestión Estricta de Credenciales y APIs:**
> Este repositorio **no almacena claves de API ni contraseñas reales**. Toda configuración sensible se gestiona exclusivamente a través de variables de entorno locales (`.env`) o montajes de Docker Secrets (`*_FILE`), las cuales están completamente excluidas del control de versiones mediante `.gitignore`.

### Variables de Entorno Requeridas (`backend/.env`):
```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=pqrs_user
DB_PASSWORD=tu_contraseña_postgres
DB_NAME=pqrs_db
JWT_SECRET=tu_secreto_seguro_jwt_2026
PINECONE_API_KEY=tu_clave_pinecone
PINECONE_INDEX=documind
GEMINI_API_KEY=tu_clave_google_gemini
N8N_WEBHOOK_URL=http://localhost:5678/webhook/radicar-pqrs
TRUST_PROXY=false
```

### Variables de Entorno Frontend (`frontend/.env`):
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## 🏗️ 3. Arquitectura del Sistema

```mermaid
flowchart TD
    subgraph Frontend["Frontend (React 18 + Vite + Tailwind)"]
        UI_Rad["Portal Público PQRS"]
        UI_Dash["Dashboard TI & Métricas"]
        UI_RAG["Chat RAG con IA"]
        UI_Ing["Ingesta Documental & Repos"]
        UI_PQRS["Gestión PQRS Funcionarios"]
    end

    subgraph Backend["Backend API (Node.js + Express 4)"]
        Auth["Auth & RBAC (JWT)"]
        DocCtl["Controlador Documental"]
        ChatCtl["Motor RAG & Comparación"]
        PqrsCtl["Gestión Tickets & Asignación"]
        Sec["Secrets Manager Seguro"]
    end

    subgraph Datos["Capa de Persistencia & Orquestación"]
        PG[("PostgreSQL 16 (pqrs_db)")]
        N8N["n8n Workflow Engine"]
        PC[("Pinecone Vector DB")]
        GEMINI["Google Gemini AI"]
    end

    Frontend -->|HTTP / REST| Backend
    Backend --> PG
    Backend --> PC
    Backend --> GEMINI
    Frontend -.->|Webhooks Radicación| N8N
    N8N --> PG
```

---

## 🚀 4. Puesta en Marcha Rápida (Windows)

La plataforma incluye scripts automatizados de ciclo de vida para Windows en la raíz del proyecto:

### Iniciar todos los servicios:
Haga doble clic o ejecute desde PowerShell:
```cmd
.\iniciar_documind_pqrs.bat
```
El script realiza automáticamente:
1. Verificación e inicio de **Docker Desktop**.
2. Levantamiento de contenedores de persistencia (**PostgreSQL 16** y **n8n** en red puente).
3. Inicialización del servidor API **Node.js** (`http://localhost:5000`).
4. Inicialización del servidor de desarrollo **Vite** (`http://localhost:5173`).
5. Apertura del navegador en la plataforma.

### Detener todos los servicios limpiamente:
```cmd
.\detener_documind_pqrs.bat
```
Detiene de manera ordenada los servidores Node/Vite y apaga los contenedores Docker liberando memoria RAM y puertos de red.

---

## 🧪 5. Batería de Pruebas y Aseguramiento de Calidad (QA)

El proyecto cuenta con una cobertura integral de pruebas automatizadas:

```bash
# Pruebas unitarias y de integración de backend:
cd backend
npm test

# Benchmark automatizado de visión multimodal (20 imágenes con reporte estadístico):
node ../tests/evaluar_vision_20_imagenes.js

# Compilación y verificación de empaquetado de frontend:
cd ../frontend
npm run build
```

---

## 📚 6. Documentación y Entregables Académicos

Toda la documentación ejecutiva y técnica de sustentación se encuentra organizada en el directorio [`docs/`](file:///docs):

| Documento | Descripción |
| --- | --- |
| [`DOCUMENTO_TECNICO_TERCER_CORTE.md`](file:///docs/DOCUMENTO_TECNICO_TERCER_CORTE.md) | **Documento Técnico Oficial del Tercer Corte:** Arquitectura, Ruta A, módulo de visión multimodal, benchmark y respuestas de sustentación (Máx. 10 págs). |
| [`LIBRETO_SUSTENTACION_TERCER_CORTE.md`](file:///docs/LIBRETO_SUSTENTACION_TERCER_CORTE.md) | **Libreto Oficial de Sustentación Oral (15 Minutos):** Estructura dividida por integrantes y banco de respuestas para las 4 preguntas del docente. |
| [`GUION_VIDEO_DEMO_TERCER_CORTE.md`](file:///docs/GUION_VIDEO_DEMO_TERCER_CORTE.md) | **Guión Oficial del Video de Demostración (8 Minutos):** Recorrido paso a paso escena por escena para grabación con OBS/Loom. |
| [`GUIA_DESPLIEGUE_NUBE_GRATUITA.md`](file:///docs/GUIA_DESPLIEGUE_NUBE_GRATUITA.md) | **Guía Oficial de Despliegue en la Nube Gratuita:** Render, Supabase, Vercel, Dockerfile, variables de entorno y credenciales de prueba para el evaluador. |
| [`PANEL_SUSTENTACION.html`](file:///docs/PANEL_SUSTENTACION.html) | **Panel Interactivo de Sustentación:** Dashboard visual para proyectar en clase con laboratorio de pruebas y preguntas del docente. |
| [`REPORTE_EVALUACION_VISION_20.md`](file:///docs/REPORTE_EVALUACION_VISION_20.md) | Reporte estadístico del benchmark de 20 casos reales fotografiados con celular. |
| [`Guia_Tercer_Corte_Desarrollo_de_Aplicaciones_Empresariales.pdf`](file:///docs/Guia_Tercer_Corte_Desarrollo_de_Aplicaciones_Empresariales.pdf) | Guía oficial del docente Wilson Castaño Galviz (26/10/2026). |
| [`SEMANA_1_DISENO.pdf`](file:///docs/SEMANA_1_DISENO.pdf) | Documento de diseño arquitectónico y de inventario de flujos de Semana 1. |
| [`INFORME_FINAL_ENTREGA_DOCUMIND.md`](file:///docs/INFORME_FINAL_ENTREGA_DOCUMIND.md) | Informe técnico con arquitectura, casos de uso, matriz de seguridad y métricas. |
| [`RESUMEN_EJECUTIVO_DOCUMIND.md`](file:///docs/RESUMEN_EJECUTIVO_DOCUMIND.md) | Síntesis ejecutiva de alto impacto para evaluadores y jurados. |
| [`PRESENTACION_DOCUMIND.md`](file:///docs/PRESENTACION_DOCUMIND.md) | Estructura diapositiva por diapositiva para la defensa y sustentación oral. |
| [`GUION_DEMO_DOCUMIND.md`](file:///docs/GUION_DEMO_DOCUMIND.md) | Guión paso a paso para la demostración en vivo de la plataforma. |
| [`PREGUNTAS_DEFENSA_DOCUMIND.md`](file:///docs/PREGUNTAS_DEFENSA_DOCUMIND.md) | Banco de preguntas técnicas difíciles y respuestas sustentadas sobre arquitectura, RAG y seguridad. |
| [`MATRIZ_ACEPTACION_DOCUMIND.md`](file:///docs/MATRIZ_ACEPTACION_DOCUMIND.md) | Matriz de pruebas de aceptación UAT y criterios de calidad. |
| [`DRP_PLAN_RECUPERACION.md`](file:///docs/DRP_PLAN_RECUPERACION.md) | Plan de contingencia, continuidad del negocio y recuperación ante desastres (DRP/HA). |
| [`PANEL_SUSTENTACION.html`](file:///docs/PANEL_SUSTENTACION.html) | Panel interactivo de apoyo visual para la exposición en clase. |

---

## 👥 7. Autores y Créditos

- **Desarrollador Líder:** Juan Felipe ([@JuanFe28](https://github.com/JuanFe28))
- **Plataforma:** DocuMind & PQRS B2B
- **Tecnologías:** Node.js, Express, React, Vite, Tailwind CSS, PostgreSQL 16, n8n, Google Gemini AI, Pinecone.
