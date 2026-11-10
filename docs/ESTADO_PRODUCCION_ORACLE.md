# Estado de Producción — Oracle Cloud / Presentación

**Fecha de verificación:** 09/11/2026 20:21 (UTC-5)
**Rama:** `main`
**Commit base:** `cdceb10` (los ajustes de esta verificación quedaron en el árbol de trabajo)
**Entorno:** Windows, Node.js v24.19.0, npm 11.17.0, `@google/genai` 1.52.0, Vite 5.4.21

## Veredicto

El aplicativo está listo para la presentación del Componente 2. Los tres puntos solicitados quedaron verificados: Semana Uno ya no se expone en el frontend, las muestras de `/vision` se cargan y analizan con un solo clic, y el pipeline multimodal responde en vivo.

Existe una sola salvedad externa: al momento de esta verificación la cuota gratuita diaria de `gemini-3.8-flash` y `gemini-3.5-flash` estaba agotada (HTTP 429, límite gratuito de 20 solicitudes por día). Los dos modelos existen y están configurados como primarios; el sistema conmutó automáticamente a `gemini-3.1-flash-lite` y completó la extracción real con 0.98 de confianza. La cuota se restablece a medianoche del Pacífico (03:00 en Colombia) y el respaldo local Plan B garantiza que la demo nunca responda con error 500.

## 1. Semana Uno retirada del frontend

| Elemento | Estado |
|---|---|
| Ruta `/semana-1` en `frontend/src/App.jsx` | Eliminada (no existe import ni `Route`) |
| Enlaces en `Sidebar.jsx` y `Login.jsx` | Eliminados |
| Página `frontend/src/pages/SemanaUno.jsx` | Eliminada |
| PDF `frontend/public/SEMANA_1_DISENO.pdf` | Eliminado del paquete web |
| Documento académico `docs/SEMANA_1_DISENO.md` y `.pdf` | Conservado únicamente como material histórico en `docs/` |
| Búsqueda de referencias en `frontend/src` | Sin resultados de `SemanaUno`, `/semana-1` o `semana1` |
| Build de producción | Compila sin referencias a Semana Uno; `dist/` no incluye el PDF |

La ruta `/vision` es pública y no exige login (`App.jsx`), condición útil para iniciar la demostración directamente.

## 2. Muestras de `/vision` con un solo clic

Las tres muestras están empaquetadas en `frontend/public/muestras/` y se copian a `dist/muestras/` durante el build:

| Muestra | Archivo | Tamaño | Validación |
|---|---|---|---|
| Soporte Técnico | `01_soporte.jpg` | 84.883 bytes | Cabecera JPEG `FF D8 FF` |
| Facturación Duplicada | `02_facturacion.jpg` | 86.105 bytes | Cabecera JPEG `FF D8 FF` |
| Garantía Hardware | `03_garantia.jpg` | 84.271 bytes | Cabecera JPEG `FF D8 FF` |

Comportamiento implementado en `DigitalizacionVision.jsx`:

1. Un clic en la tarjeta descarga la imagen desde `/muestras/...` con `cache: 'no-store'`.
2. La convierte en `File` y muestra la previsualización.
3. Dispara automáticamente `POST /api/vision/procesar-formulario` sin exigir un segundo botón.
4. Si la cuota o la red fallan, el backend responde con Plan B heurístico en lugar de un error.

Prueba HTTP real ejecutada contra el backend levantado en `localhost:5000`, con la muestra `01_soporte.jpg`:

| Campo | Resultado |
|---|---|
| HTTP | 200, `ok=true`, `status=success` |
| Modelo | `Google gemini-3.1-flash-lite Vision (Multimodal)` |
| Plan B | `false` |
| Confianza | 0.98 |
| Solicitante extraído | Carlos Mendez |
| Asunto extraído | Caída de enlace dedicado en sucursal norte |
| URL protegida | `/api/vision/archivos/vision-1794273598784-919971348.jpg` |

También se validó el servicio con la muestra `02_facturacion.jpg`: extracción de "Maria Camila Restrepo", reclamo por cobro duplicado de factura en la nube y confianza 0.98.

## 3. Modelos Gemini 3.5 / 3.8 Flash en el backend

La lista de modelos quedó centralizada en `backend/config/geminiModels.js` y se usa en visión, análisis documental y chat:

```js
[
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
]
```

Cambios relevantes:

- `gemini-3.8-flash` y `gemini-3.5-flash` pasaron a ser los modelos primarios.
- Se retiraron `gemini-2.5-flash` y `gemini-2.5-flash-lite`, que la API ya responde con HTTP 404 ("no longer available to new users").
- Se agregó `gemini-3.1-flash-lite` como respaldo en vivo antes del Plan B local.
- Los errores por modelo ahora se registran con su causa en el mensaje de fallo, sin exponer datos personales.

Resultado de la verificación directa contra Google Generative Language API:

| Modelo | Disponible en `models.list()` | `generateContent` al 09/11/2026 20:21 |
|---|---|---|
| `gemini-3.8-flash` | Sí | HTTP 429 — cuota gratuita agotada (límite 20/día) |
| `gemini-3.5-flash` | Sí | HTTP 429 — cuota gratuita agotada (límite 20/día) |
| `gemini-3.1-flash-lite` | Sí | HTTP 200 — respuesta "OK" |
| `gemini-flash-latest` | Sí (alias de la familia 3.8) | HTTP 429 por la misma cuota |

El fallo 429 es una restricción de cuota de la cuenta gratuita, no un error de código ni un modelo inexistente. El pipeline completo se verificó en vivo por la ruta de respaldo y devolvió extracción multimodal válida en 8,3 segundos.

## 4. Pruebas ejecutadas

| Prueba | Comando | Resultado |
|---|---|---|
| Suite backend | `cd backend; npm test` | 6 suites, 114/114 pruebas aprobadas, ~26 s |
| Build frontend | `cd frontend; npm run build` | 1.580 módulos, compilación exitosa en 15,7 s |
| Endpoint de salud | `GET http://localhost:5000/api/health` | `ok=true`, servicio `DocuMind API v1.0` |
| Endpoint de visión | `POST /api/vision/procesar-formulario` con muestra real | HTTP 200, extracción válida, sin Plan B |
| Sintaxis Compose Oracle | `docker compose -f docker-compose.oracle.yml config --quiet` | Válida |

Los avisos de base de datos durante la suite son esperados: Jest no levanta PostgreSQL y el registro de auditoría degrada sin interrumpir el flujo.

## 5. Estado del despliegue en Oracle Cloud

La configuración de despliegue está presente y validada sintácticamente:

| Componente | Archivo / configuración |
|---|---|
| Stack completo | `docker-compose.oracle.yml` |
| Backend | Node 20 Alpine, puerto interno 5000, healthcheck `/api/health` |
| Frontend | Build Vite + Nginx, publicación `8300:80` |
| Base de datos | PostgreSQL 16 Alpine con volumen `documind_pgdata` |
| Túnel público | Cloudflare Tunnel (`cloudflared`) |
| Script de despliegue | `deploy_oracle.sh` (build sin caché, `up -d`, extracción de URL HTTPS) |
| Variables requeridas | `GEMINI_API_KEY` en el `.env` del servidor |

No se ejecutó un despliegue remoto desde esta máquina; la validación local cubrió build, pruebas, healthcheck, endpoint de visión y sintaxis del Compose. Antes de la presentación se recomienda ejecutar `./deploy_oracle.sh` en la instancia Oracle y confirmar la URL de `trycloudflare`.

## 6. Checklist para la presentación

1. Verificar que la cuota de Gemini se haya restablecido (medianoche del Pacífico / 03:00 Colombia):
   - Abrir `/vision` y hacer clic en una muestra.
   - Esperado: modelo `gemini-3.8-flash` o `gemini-3.5-flash`, `es_plan_b=false`.
   - Si la cuota sigue agotada: el resultado mostrará `gemini-3.1-flash-lite`, también en vivo.
   - Si no hay red o cuota: el resultado mostrará `Plan B (Contingencia Local Heurística)` y la demo continúa.
2. Confirmar `GET /api/health` en el dominio publicado.
3. Tener a mano las tres muestras locales como respaldo en caso de fallar el túnel.
4. No ejecutar el benchmark de 20 imágenes ni pruebas masivas antes de la demo: consume la cuota diaria de los modelos 3.8/3.5.

## 7. Riesgos y observaciones

| Riesgo | Mitigación |
|---|---|
| Cuota gratuita de 3.8/3.5 agotada | Respaldo en vivo con `gemini-3.1-flash-lite` y Plan B determinista |
| Latencia variable de Gemini | Timeout de 12 s por modelo y conmutación automática |
| JWT y contraseña de PostgreSQL fijados en `docker-compose.oracle.yml` | Aceptable para la demo; para producción real moverlos a secretos o variables de entorno |
| Túnel `trycloudflare` cambia de URL al reiniciar | Obtener la URL con `docker logs documind_tunnel` |
| Datos de prueba sin PostgreSQL local | La suite usa mocks; para la demo usar el stack Compose con PostgreSQL |

## Conclusión

Semana Uno quedó fuera de la aplicación, las muestras de `/vision` funcionan con un clic y el backend opera con Gemini 3.5/3.8 como modelos primarios, con respaldo en vivo y Plan B. La única condición pendiente es externa y temporal: la cuota gratuita de los modelos 3.8/3.5 se restablece antes de la presentación. El proyecto está listo para demostrarse.
