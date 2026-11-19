-- ==============================================================================
-- DOCUMIND & PQRS INTEGRATION SCHEMA (PostgreSQL 16)
-- Tablas de gestión documental, metadatos RAG y asistentes virtuales integrados
-- ==============================================================================

-- 1. Tabla de Usuarios para DocuMind
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(30) NOT NULL DEFAULT 'ADMIN', -- 'ADMIN', 'SUPERVISOR', 'AGENTE', 'LEGAL', 'FINANCIERO', 'RECLUTADOR'
    departamento VARCHAR(100),
    creado_en TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT usuarios_rol_valido CHECK (
        rol IN ('ADMIN', 'SUPERVISOR', 'AGENTE', 'LEGAL', 'FINANCIERO', 'RECLUTADOR')
    )
);

-- Migración idempotente para bases existentes: amplía el dominio de roles y
-- agrega el departamento operativo sin invalidar registros históricos.
DO $$ BEGIN
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS departamento VARCHAR(100);
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usuarios_rol_valido' AND conrelid = 'usuarios'::regclass
    ) THEN
        ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_valido CHECK (
            rol IN ('ADMIN', 'SUPERVISOR', 'AGENTE', 'LEGAL', 'FINANCIERO', 'RECLUTADOR')
        ) NOT VALID;
    END IF;
END $$;

-- Usuarios por defecto para DocuMind (Contraseña: Admin2026*!)
INSERT INTO usuarios (nombre, email, password_hash, rol)
VALUES 
    ('Administrador DocuMind', 'admin@documind.com', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'ADMIN'),
    ('Wilson Castaño', 'wilson.admin@documind.com', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'ADMIN'),
    ('Diana Rodríguez', 'diana.legal@documind.com', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'LEGAL'),
    ('Carlos Sánchez', 'carlos.financiero@documind.com', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'FINANCIERO'),
    ('María Torres', 'maria.reclutador@documind.com', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'RECLUTADOR')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Cuentas operativas semilla (idempotentes por email)
INSERT INTO usuarios (nombre, email, password_hash, rol, departamento)
VALUES
    ('Andrea Silva', 'andrea.silva@techflow.co', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'SUPERVISOR', 'Soporte Técnico'),
    ('Carlos Restrepo', 'carlos.restrepo@techflow.co', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'AGENTE', 'Facturación y Cobranzas'),
    ('Valeria Gómez', 'valeria.gomez@techflow.co', '$2a$10$IO84EQh14.ToI98o6XpzGeuc4sMcU99C98ZtmofxuOwyvAdc9QClq', 'AGENTE', 'Calidad y Servicio')
ON CONFLICT (email) DO NOTHING;

SELECT setval(pg_get_serial_sequence('usuarios', 'id'), COALESCE((SELECT MAX(id) FROM usuarios), 1));

-- 2. Tabla de Repositorios (Carpetas lógicas de conocimiento)
CREATE TABLE IF NOT EXISTS repositorios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    slug VARCHAR(120) UNIQUE,
    descripcion TEXT,
    departamento VARCHAR(50) NOT NULL,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Migración idempotente del identificador estable de repositorio
ALTER TABLE repositorios ADD COLUMN IF NOT EXISTS slug VARCHAR(120);
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'repositorios_slug_key' AND conrelid = 'repositorios'::regclass
    ) THEN
        ALTER TABLE repositorios ADD CONSTRAINT repositorios_slug_key UNIQUE (slug);
    END IF;
END $$;

-- Repositorio por defecto de la empresa
INSERT INTO repositorios (id, nombre, descripcion, departamento, usuario_id)
VALUES (
    1,
    'Contratos Legales 2026',
    'Base de conocimiento oficial para contratos y resoluciones legales',
    'Legal',
    1
) ON CONFLICT (id) DO NOTHING;

-- Tercer repositorio oficial: manuales, normativa y protocolos PQRS
INSERT INTO repositorios (id, nombre, slug, descripcion, departamento, usuario_id)
VALUES (
    3,
    'Manuales, Normativa y Protocolos PQRS',
    'normativa-pqrs',
    'Repositorio institucional con manuales, normativa, protocolos de SLA, facturación, habeas data y diagnóstico de infraestructura',
    'Normativa PQRS',
    1
) ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    slug = EXCLUDED.slug,
    descripcion = EXCLUDED.descripcion,
    departamento = EXCLUDED.departamento,
    usuario_id = EXCLUDED.usuario_id;

SELECT setval(pg_get_serial_sequence('repositorios', 'id'), COALESCE((SELECT MAX(id) FROM repositorios), 1));

-- 3. Tabla de Documentos Ingestados (con vínculo opcional a Tickets PQRS)
CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    nombre_archivo VARCHAR(255) NOT NULL,
    url_descarga TEXT NOT NULL,
    tipo_formato VARCHAR(10) NOT NULL,
    tamano_bytes BIGINT NOT NULL,
    categoria_detectada VARCHAR(50),
    score_confianza DECIMAL(5,2),
    resumen_ia TEXT,
    estado_procesamiento VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ERROR'
    repositorio_id INT NOT NULL REFERENCES repositorios(id) ON DELETE CASCADE,
    ticket_id VARCHAR(30), -- Vínculo opcional con pqrs_solicitudes
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Metadatos Extraídos por IA (JSON estructurado)
CREATE TABLE IF NOT EXISTS metadatos_extraidos (
    id SERIAL PRIMARY KEY,
    documento_id INT NOT NULL UNIQUE REFERENCES documentos(id) ON DELETE CASCADE,
    metadata_json JSONB NOT NULL,
    fecha_extraccion TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Logs de Errores y Diagnóstico TI
CREATE TABLE IF NOT EXISTS logs_errores (
    id SERIAL PRIMARY KEY,
    documento_id INT,
    severidad VARCHAR(20) NOT NULL, -- 'INFO', 'WARNING', 'ERROR', 'CRITICAL'
    mensaje_error TEXT NOT NULL,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Logs de Consultas y Métricas de IA
CREATE TABLE IF NOT EXISTS consultas_logs (
    id SERIAL PRIMARY KEY,
    usuario_id INT,
    query_texto TEXT NOT NULL,
    tokens_utilizados INT DEFAULT 0,
    tiempo_respuesta_ms INT DEFAULT 0,
    score_confianza DECIMAL(5,2),
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Hilos de Conversación del Asistente Virtual (Chat Threads)
CREATE TABLE IF NOT EXISTS chat_threads (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    repositorio_id INT REFERENCES repositorios(id) ON DELETE CASCADE,
    ticket_id VARCHAR(30), -- Permite chatear en contexto de un ticket específico
    titulo VARCHAR(150) DEFAULT 'Nueva conversación',
    creado_en TIMESTAMPTZ DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Mensajes del Chat RAG
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    thread_id INT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    rol VARCHAR(20) NOT NULL, -- 'user', 'ia', 'system'
    contenido TEXT NOT NULL,
    fuentes JSONB,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Fragmentos de Documentos para Búsqueda Semántica Local (Chunks)
CREATE TABLE IF NOT EXISTS documentos_chunks (
    id SERIAL PRIMARY KEY,
    documento_id INT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    texto_chunk TEXT NOT NULL,
    metadatos JSONB,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Índices idempotentes para repositorios y recuperación documental
CREATE INDEX IF NOT EXISTS idx_documentos_repositorio ON documentos(repositorio_id);
CREATE INDEX IF NOT EXISTS idx_documentos_estado ON documentos(estado_procesamiento);
CREATE INDEX IF NOT EXISTS idx_metadatos_documento ON metadatos_extraidos(documento_id);
CREATE INDEX IF NOT EXISTS idx_chunks_documento ON documentos_chunks(documento_id, chunk_index);

-- 11. Semilla idempotente de los 4 documentos institucionales del repositorio oficial
DO $$
DECLARE
    v_doc_id INT;
BEGIN
    -- Documento 1: Protocolo de SLAs y escalamiento
    INSERT INTO documentos (
        nombre_archivo, url_descarga, tipo_formato, tamano_bytes,
        categoria_detectada, score_confianza, resumen_ia,
        estado_procesamiento, repositorio_id
    )
    SELECT
        'protocolo_sla_y_escalamiento.md',
        '/uploads/normativa-pqrs/protocolo_sla_y_escalamiento.md',
        'MD',
        5480,
        'Normativa PQRS',
        0.99,
        'Protocolo oficial de SLAs (Crítica 2h, Alta/Reclamo 4h, Media 24h, Baja 48h) y reglas de escalamiento a Nivel 2.',
        'COMPLETADO',
        3
    WHERE NOT EXISTS (
        SELECT 1 FROM documentos
        WHERE nombre_archivo = 'protocolo_sla_y_escalamiento.md' AND repositorio_id = 3
    );

    SELECT id INTO v_doc_id FROM documentos
    WHERE nombre_archivo = 'protocolo_sla_y_escalamiento.md' AND repositorio_id = 3
    ORDER BY id LIMIT 1;

    IF v_doc_id IS NOT NULL THEN
        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 0, $txt$Manual de SLAs y Escalamiento PQRS - TechFlow

Toda solicitud radicada por el canal PQRS recibe un plazo máximo de atención calculado en horas corridas desde la fecha de radicación:

- Prioridad Crítica: 2 horas.
- Prioridad Alta o tipo Reclamo: 4 horas.
- Prioridad Media: 24 horas.
- Prioridad Baja: 48 horas.

El reloj del SLA no se detiene por cambios de estado ni por respuestas al cliente. La fecha límite se registra en sla_fecha_limite y el sistema emite alertas cuando consume el 50%, 75% y 90% del tiempo disponible.$txt$,
        jsonb_build_object('seccion', 'Plazos SLA', 'orden', 0, 'documento', 'protocolo_sla_y_escalamiento.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 0
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 1, $txt$Escalamiento Nivel 2

Un ticket escala a Nivel 2 cuando: (1) alcanza el 75% del SLA sin una gestión efectiva registrada, (2) requiere intervención de infraestructura, seguridad o proveedores externos, o (3) el cliente reabre un caso previamente cerrado por inconformidad.

El escalamiento lo realiza el agente o supervisor asignado, registrando una nota interna con el motivo, las acciones adelantadas y el responsable Nivel 2. El supervisor de Soporte Técnico confirma la recepción en un máximo de 30 minutos y asume la comunicación con el cliente. Todo escalamiento conserva la prioridad original y no reinicia el SLA.$txt$,
        jsonb_build_object('seccion', 'Escalamiento Nivel 2', 'orden', 1, 'documento', 'protocolo_sla_y_escalamiento.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 1
        );

        INSERT INTO metadatos_extraidos (documento_id, metadata_json)
        VALUES (v_doc_id, $json${
            "categoria": "Normativa PQRS",
            "subcategoria": "SLA y Escalamiento",
            "version": "2026.1",
            "confidencialidad": "INTERNA",
            "etiquetas": ["sla", "escalamiento", "nivel 2", "critica", "reclamo"],
            "vigencia": "2026-12-31",
            "autor": "Dirección de Servicio y Soporte"
        }$json$::jsonb)
        ON CONFLICT (documento_id) DO NOTHING;
    END IF;

    -- Documento 2: Manual de facturación y notas crédito
    INSERT INTO documentos (
        nombre_archivo, url_descarga, tipo_formato, tamano_bytes,
        categoria_detectada, score_confianza, resumen_ia,
        estado_procesamiento, repositorio_id
    )
    SELECT
        'manual_facturacion_y_notas_credito.md',
        '/uploads/normativa-pqrs/manual_facturacion_y_notas_credito.md',
        'MD',
        6120,
        'Facturación',
        0.98,
        'Procedimiento para atender cobros duplicados, emitir notas crédito, aplicar plazos y conservar trazabilidad contable.',
        'COMPLETADO',
        3
    WHERE NOT EXISTS (
        SELECT 1 FROM documentos
        WHERE nombre_archivo = 'manual_facturacion_y_notas_credito.md' AND repositorio_id = 3
    );

    SELECT id INTO v_doc_id FROM documentos
    WHERE nombre_archivo = 'manual_facturacion_y_notas_credito.md' AND repositorio_id = 3
    ORDER BY id LIMIT 1;

    IF v_doc_id IS NOT NULL THEN
        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 0, $txt$Manual de Facturación y Notas Crédito - Cobros duplicados

Ante un reporte de cobro duplicado, el agente de Facturación y Cobranzas debe: 1) verificar la transacción en la pasarela de pagos y comparar el identificador único de cada intento; 2) validar que ambos débitos correspondan, en monto y fecha, a la misma orden de servicio; 3) registrar el caso como Reclamo de prioridad Alta con plazo de 4 horas; 4) solicitar la aprobación del supervisor de Facturación antes de cualquier reversión.

No se debe reversar un pago directamente sobre la pasarela sin aprobación del supervisor ni sin dejar evidencia en el ticket. Si el cobro duplicado se confirma, se genera una nota crédito a favor del cliente.$txt$,
        jsonb_build_object('seccion', 'Cobros duplicados', 'orden', 0, 'documento', 'manual_facturacion_y_notas_credito.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 0
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 1, $txt$Emisión de notas crédito y plazos

La nota crédito aplica cuando se confirma un cobro duplicado, un error de tarifa, una devolución aprobada o un ajuste comercial autorizado. El procedimiento es: solicitud del área comercial o del cliente, validación del área de Facturación, aprobación del supervisor (montos hasta 5 SMMLV) o del director financiero (montos superiores), y emisión en el sistema contable.

Plazos: la nota crédito se emite en máximo 5 días hábiles contados desde la aprobación del caso y se refleja en la siguiente facturación o en la devolución bancaria dentro de 10 días hábiles. El agente informa al cliente el número de nota crédito, el valor y la fecha estimada de aplicación, y adjunta el soporte al ticket PQRS. Los casos con nota crédito nunca se cierran sin la confirmación del área financiera.$txt$,
        jsonb_build_object('seccion', 'Notas crédito y plazos', 'orden', 1, 'documento', 'manual_facturacion_y_notas_credito.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 1
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 2, $txt$Conciliación y trazabilidad contable

Cada nota crédito se cruza con la factura original y con el radicado PQRS. Tesorería concilia semanalmente las cuentas por cobrar y reporta diferencias al supervisor de Facturación. Los soportes contables se conservan por 10 años conforme a la política de archivo. Los ajustes de cartera deben quedar aprobados y documentados antes del cierre mensual.$txt$,
        jsonb_build_object('seccion', 'Conciliación y trazabilidad', 'orden', 2, 'documento', 'manual_facturacion_y_notas_credito.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 2
        );

        INSERT INTO metadatos_extraidos (documento_id, metadata_json)
        VALUES (v_doc_id, $json${
            "categoria": "Facturación",
            "subcategoria": "Cobros y notas crédito",
            "version": "2026.1",
            "confidencialidad": "INTERNA",
            "etiquetas": ["facturacion", "cobro duplicado", "nota credito", "plazos", "tesoreria"],
            "vigencia": "2026-12-31",
            "autor": "Dirección Financiera"
        }$json$::jsonb)
        ON CONFLICT (documento_id) DO NOTHING;
    END IF;

    -- Documento 3: Política de tratamiento de datos personales (Ley 1581)
    INSERT INTO documentos (
        nombre_archivo, url_descarga, tipo_formato, tamano_bytes,
        categoria_detectada, score_confianza, resumen_ia,
        estado_procesamiento, repositorio_id
    )
    SELECT
        'politica_ley_1581_habeas_data.md',
        '/uploads/normativa-pqrs/politica_ley_1581_habeas_data.md',
        'MD',
        5870,
        'Legal',
        0.99,
        'Política de tratamiento de datos personales: consentimiento, finalidad, tracking_token UUID, protección de notas internas y derechos del titular.',
        'COMPLETADO',
        3
    WHERE NOT EXISTS (
        SELECT 1 FROM documentos
        WHERE nombre_archivo = 'politica_ley_1581_habeas_data.md' AND repositorio_id = 3
    );

    SELECT id INTO v_doc_id FROM documentos
    WHERE nombre_archivo = 'politica_ley_1581_habeas_data.md' AND repositorio_id = 3
    ORDER BY id LIMIT 1;

    IF v_doc_id IS NOT NULL THEN
        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 0, $txt$Política de Tratamiento de Datos Personales - Ley 1581 de 2012

TechFlow actúa como responsable del tratamiento de los datos personales capturados en los formularios PQRS. Solo se recolectan los datos necesarios: nombre, documento, correo, teléfono, dirección y descripción de la solicitud. La finalidad es gestionar la petición, contactar al titular, cumplir obligaciones legales y generar métricas agregadas.

El tratamiento requiere consentimiento previo, expreso e informado del titular, salvo las excepciones legales. No se usan los datos para fines distintos sin nueva autorización. Los datos sensibles y de menores de edad reciben protección reforzada y acceso restringido.$txt$,
        jsonb_build_object('seccion', 'Tratamiento y consentimiento', 'orden', 0, 'documento', 'politica_ley_1581_habeas_data.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 0
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 1, $txt$Seguridad, tracking_token y notas internas

Cada radicado recibe un tracking_token UUID opaco que funciona como clave privada de consulta. El token no contiene datos personales y debe tratarse como credencial: no se publica en URLs, correos masivos ni reportes. El cliente accede únicamente a su expediente y nunca a notas internas del equipo.

Las notas internas se marcan con es_nota_interna = true y se excluyen de toda vista pública o de seguimiento ciudadano. El acceso a expedientes completos está restringido a funcionarios autorizados según rol y departamento. Los registros de acceso se conservan para auditoría y trazabilidad.$txt$,
        jsonb_build_object('seccion', 'tracking_token y notas internas', 'orden', 1, 'documento', 'politica_ley_1581_habeas_data.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 1
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 2, $txt$Derechos del titular y plazos de atención

El titular puede conocer, actualizar, rectificar y suprimir sus datos, revocar la autorización y presentar quejas ante la Superintendencia de Industria y Comercio. Las consultas se atienden en máximo 15 días hábiles y los reclamos en máximo 15 días hábiles, prorrogables por 8 días hábiles cuando sea necesario.

Las solicitudes de supresión proceden cuando el dato no sea necesario para la finalidad, exista tratamiento ilícito o el titular revoque la autorización. Los datos asociados a obligaciones legales o contractuales pueden conservarse con acceso restringido y medidas de seguridad apropiadas.$txt$,
        jsonb_build_object('seccion', 'Derechos ARCO y plazos', 'orden', 2, 'documento', 'politica_ley_1581_habeas_data.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 2
        );

        INSERT INTO metadatos_extraidos (documento_id, metadata_json)
        VALUES (v_doc_id, $json${
            "categoria": "Legal",
            "subcategoria": "Habeas Data",
            "marco_legal": "Ley 1581 de 2012",
            "confidencialidad": "ALTA",
            "etiquetas": ["habeas data", "datos personales", "consentimiento", "tracking_token", "notas internas"],
            "vigencia": "2026-12-31",
            "autor": "Oficina Jurídica"
        }$json$::jsonb)
        ON CONFLICT (documento_id) DO NOTHING;
    END IF;

    -- Documento 4: Guía de diagnóstico de errores 502 e infraestructura
    INSERT INTO documentos (
        nombre_archivo, url_descarga, tipo_formato, tamano_bytes,
        categoria_detectada, score_confianza, resumen_ia,
        estado_procesamiento, repositorio_id
    )
    SELECT
        'guia_diagnostico_soporte_502_infraestructura.md',
        '/uploads/normativa-pqrs/guia_diagnostico_soporte_502_infraestructura.md',
        'MD',
        6340,
        'Soporte Técnico',
        0.98,
        'Runbook para diagnosticar errores 502 Bad Gateway, validar autenticación JWT y ejecutar failover de infraestructura.',
        'COMPLETADO',
        3
    WHERE NOT EXISTS (
        SELECT 1 FROM documentos
        WHERE nombre_archivo = 'guia_diagnostico_soporte_502_infraestructura.md' AND repositorio_id = 3
    );

    SELECT id INTO v_doc_id FROM documentos
    WHERE nombre_archivo = 'guia_diagnostico_soporte_502_infraestructura.md' AND repositorio_id = 3
    ORDER BY id LIMIT 1;

    IF v_doc_id IS NOT NULL THEN
        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 0, $txt$Guía de Diagnóstico de Errores 502 Bad Gateway

El error 502 indica que el proxy o balanceador no recibió una respuesta válida del servicio upstream. Pasos de diagnóstico: 1) revisar logs de Nginx/Apache y del contenedor backend; 2) verificar el estado del proceso Node.js y su puerto interno; 3) comprobar conexiones y latencia hacia PostgreSQL; 4) validar que las políticas de timeout y keepalive del proxy sean suficientes; 5) revisar CPU, memoria y reinicios recientes del contenedor.

Si el upstream está caído, se reinicia el servicio de forma controlada y se registra la causa. Si el fallo persiste, se escala al equipo de infraestructura como prioridad Crítica con SLA de 2 horas.$txt$,
        jsonb_build_object('seccion', 'Diagnóstico 502', 'orden', 0, 'documento', 'guia_diagnostico_soporte_502_infraestructura.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 0
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 1, $txt$Autenticación y errores relacionados

Antes de escalar un 502, verificar que las rutas de autenticación respondan y que JWT_SECRET esté configurado correctamente en todos los nodos. Un secreto distinto entre instancias provoca respuestas 401 intermitentes, no 502. Validar también: expiración del token, relojes sincronizados, cabeceras Authorization y reglas del proxy que puedan eliminar cabeceras.

Los errores 502 no deben exponer trazas internas al cliente. El usuario recibe un mensaje controlado con el identificador de incidente y el equipo de soporte registra el diagnóstico en la bitácora interna.$txt$,
        jsonb_build_object('seccion', 'Autenticación', 'orden', 1, 'documento', 'guia_diagnostico_soporte_502_infraestructura.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 1
        );

        INSERT INTO documentos_chunks (documento_id, chunk_index, texto_chunk, metadatos)
        SELECT v_doc_id, 2, $txt$Failover y recuperación del servicio

Cuando el nodo primario no responde, se activa el procedimiento de failover: 1) confirmar la caída con al menos dos sondas de salud; 2) conmutar el tráfico al nodo o contenedor réplica; 3) verificar conectividad, autenticación y lectura de datos; 4) monitorear durante 30 minutos; 5) documentar el incidente.

La recuperación del nodo primario se realiza fuera de la ventana de mayor tráfico. Toda conmutación debe preservar la integridad transaccional y no perder solicitudes PQRS en curso. Finalizado el incidente, se realiza un postmortem sin culpables y se actualizan los runbooks.$txt$,
        jsonb_build_object('seccion', 'Failover', 'orden', 2, 'documento', 'guia_diagnostico_soporte_502_infraestructura.md')
        WHERE NOT EXISTS (
            SELECT 1 FROM documentos_chunks WHERE documento_id = v_doc_id AND chunk_index = 2
        );

        INSERT INTO metadatos_extraidos (documento_id, metadata_json)
        VALUES (v_doc_id, $json${
            "categoria": "Soporte Técnico",
            "tipo": "runbook",
            "sistemas": ["nginx", "nodejs", "postgresql"],
            "confidencialidad": "INTERNA",
            "etiquetas": ["502", "bad gateway", "autenticacion", "jwt", "failover", "infraestructura"],
            "vigencia": "2026-12-31",
            "autor": "Infraestructura y TI"
        }$json$::jsonb)
        ON CONFLICT (documento_id) DO NOTHING;
    END IF;
END $$;

-- Sincronización de secuencias tras la semilla documental idempotente
SELECT setval(pg_get_serial_sequence('documentos', 'id'), COALESCE((SELECT MAX(id) FROM documentos), 1));
SELECT setval(pg_get_serial_sequence('documentos_chunks', 'id'), COALESCE((SELECT MAX(id) FROM documentos_chunks), 1));
