-- ============================================================
--  PayFlow — Esquema v4
--  + columna activo en usuarios (cobertura de viaje)
--  + monto_aprobado en lotes (aprobación parcial)
--  + banco restringido a Banrural / BAM
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100)  NOT NULL,
    correo      VARCHAR(150)  UNIQUE NOT NULL,
    contrasena  VARCHAR(64)   NOT NULL,
    categoria   VARCHAR(20)   NOT NULL CHECK (categoria IN ('autorizador', 'contador')),
    agencia     VARCHAR(100)  NOT NULL,
    activo      BOOLEAN       NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Migración segura: agrega 'activo' si la tabla ya existía
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='usuarios' AND column_name='activo'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END$$;

-- Lotes agrupa solicitudes enviadas juntas
CREATE TABLE IF NOT EXISTS lotes (
    id              SERIAL PRIMARY KEY,
    agencia         VARCHAR(100)   NOT NULL,
    creado_por      INTEGER        REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en       TIMESTAMP      NOT NULL DEFAULT NOW(),
    aprobado        BOOLEAN        DEFAULT NULL,
    monto_aprobado  NUMERIC(15,2)  DEFAULT NULL,
    descripcion     VARCHAR(200)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='lotes' AND column_name='monto_aprobado'
  ) THEN
    ALTER TABLE lotes ADD COLUMN monto_aprobado NUMERIC(15,2) DEFAULT NULL;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS solicitudes (
    id             SERIAL PRIMARY KEY,
    agencia        VARCHAR(100)   NOT NULL,
    lba            VARCHAR(100)   NOT NULL,
    descripcion    TEXT           NOT NULL,
    cafe_recibido  BOOLEAN        NOT NULL DEFAULT FALSE,
    banco          VARCHAR(20)    NOT NULL CHECK (banco IN ('Banrural', 'BAM')),
    monto          NUMERIC(15,2)  NOT NULL CHECK (monto >= 0),
    aprobado       BOOLEAN        DEFAULT NULL,
    lote_id        INTEGER        REFERENCES lotes(id) ON DELETE SET NULL,
    creado_por     INTEGER        REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en      TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aprobaciones (
    id              SERIAL PRIMARY KEY,
    lote_id         INTEGER       REFERENCES lotes(id) ON DELETE CASCADE,
    solicitud_id    INTEGER       REFERENCES solicitudes(id) ON DELETE CASCADE,
    usuario_id      INTEGER       NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    fecha_hora      TIMESTAMP     NOT NULL DEFAULT NOW(),
    ip              VARCHAR(45),
    accion          VARCHAR(20)   NOT NULL CHECK (accion IN ('aprobado', 'rechazado')),
    monto_aprobado  NUMERIC(15,2) DEFAULT NULL,
    detalle         TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='aprobaciones' AND column_name='monto_aprobado'
  ) THEN
    ALTER TABLE aprobaciones ADD COLUMN monto_aprobado NUMERIC(15,2) DEFAULT NULL;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER   NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    endpoint    TEXT      NOT NULL,
    p256dh      TEXT      NOT NULL,
    auth        TEXT      NOT NULL,
    creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(usuario_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_agencia    ON solicitudes(agencia);
CREATE INDEX IF NOT EXISTS idx_solicitudes_creado_por ON solicitudes(creado_por);
CREATE INDEX IF NOT EXISTS idx_solicitudes_lote       ON solicitudes(lote_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_banco      ON solicitudes(banco);
CREATE INDEX IF NOT EXISTS idx_aprobaciones_lote      ON aprobaciones(lote_id);
CREATE INDEX IF NOT EXISTS idx_aprobaciones_usuario   ON aprobaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_push_usuario           ON push_subscriptions(usuario_id);
CREATE INDEX IF NOT EXISTS idx_lotes_agencia          ON lotes(agencia);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo        ON usuarios(activo);

INSERT INTO usuarios (nombre, correo, contrasena, categoria, agencia, activo)
VALUES (
    'Administrador', 'admin@payflow.com',
    'a17a55ca2a9a4db3f3b08ff7ce7a3def67c4e7bec01e07d94c8f38d95b7e9a21',
    'autorizador', 'Central', TRUE
) ON CONFLICT (correo) DO NOTHING;
