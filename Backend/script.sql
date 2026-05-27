-- ============================================================
-- MindLink — Schema PostgreSQL
-- ============================================================

-- Tipos ENUM
CREATE TYPE rol_usuario    AS ENUM ('paciente', 'profesional', 'administrador');
CREATE TYPE estado_cita    AS ENUM ('pendiente', 'confirmada', 'cancelada', 'completada');
CREATE TYPE emisor_mensaje AS ENUM ('paciente', 'profesional');
CREATE TYPE tipo_pregunta  AS ENUM ('likert', 'si_no', 'texto');

-- ------------------------------------------------------------
-- usuarios
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(100)  NOT NULL,
    email          VARCHAR(150)  NOT NULL,
    contrasena     VARCHAR(255)  NOT NULL,
    rol            rol_usuario   NOT NULL,
    fecha_registro TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_usuarios_email UNIQUE (email)
);

-- ------------------------------------------------------------
-- profesionales
-- ------------------------------------------------------------
CREATE TABLE profesionales (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT NOT NULL,
    especialidad VARCHAR(150) NOT NULL,
    CONSTRAINT uq_profesionales_usuario UNIQUE (usuario_id),
    CONSTRAINT fk_prof_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- pacientes
-- ------------------------------------------------------------
CREATE TABLE pacientes (
    id               SERIAL PRIMARY KEY,
    usuario_id       INT  NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    telefono         VARCHAR(20) NOT NULL,
    profesional_id   INT DEFAULT NULL,
    CONSTRAINT uq_pacientes_usuario UNIQUE (usuario_id),
    CONSTRAINT fk_pac_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pac_profesional
        FOREIGN KEY (profesional_id) REFERENCES profesionales (id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- administradores
-- ------------------------------------------------------------
CREATE TABLE administradores (
    id                  SERIAL PRIMARY KEY,
    usuario_id          INT NOT NULL,
    perm_usuarios       BOOLEAN NOT NULL DEFAULT TRUE,
    perm_cuestionarios  BOOLEAN NOT NULL DEFAULT TRUE,
    perm_citas          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_admin_usuario UNIQUE (usuario_id),
    CONSTRAINT fk_admin_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- citas
-- ------------------------------------------------------------
CREATE TABLE citas (
    id              SERIAL PRIMARY KEY,
    paciente_id     INT NOT NULL,
    profesional_id  INT NOT NULL,
    fecha_hora      TIMESTAMPTZ NOT NULL,
    estado          estado_cita NOT NULL DEFAULT 'pendiente',
    CONSTRAINT fk_cita_paciente
        FOREIGN KEY (paciente_id) REFERENCES pacientes (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cita_profesional
        FOREIGN KEY (profesional_id) REFERENCES profesionales (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_citas_paciente    ON citas (paciente_id);
CREATE INDEX idx_citas_profesional ON citas (profesional_id);
CREATE INDEX idx_citas_fecha       ON citas (fecha_hora);

-- ------------------------------------------------------------
-- conversaciones
-- ------------------------------------------------------------
CREATE TABLE conversaciones (
    id              SERIAL PRIMARY KEY,
    paciente_id     INT NOT NULL,
    profesional_id  INT NOT NULL,
    fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_conv_paciente
        FOREIGN KEY (paciente_id) REFERENCES pacientes (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_conv_profesional
        FOREIGN KEY (profesional_id) REFERENCES profesionales (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_conv_paciente    ON conversaciones (paciente_id);
CREATE INDEX idx_conv_profesional ON conversaciones (profesional_id);

-- ------------------------------------------------------------
-- mensajes
-- ------------------------------------------------------------
CREATE TABLE mensajes (
    id               SERIAL PRIMARY KEY,
    conversacion_id  INT NOT NULL,
    emisor           emisor_mensaje NOT NULL,
    contenido        TEXT NOT NULL,
    fecha_envio      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_mens_conversacion
        FOREIGN KEY (conversacion_id) REFERENCES conversaciones (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_mensajes_conversacion ON mensajes (conversacion_id);

-- ------------------------------------------------------------
-- registros_emocionales
-- ------------------------------------------------------------
CREATE TABLE registros_emocionales (
    id          SERIAL PRIMARY KEY,
    paciente_id INT NOT NULL,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    emocion     VARCHAR(100) NOT NULL,
    intensidad  SMALLINT NOT NULL,
    CONSTRAINT chk_intensidad CHECK (intensidad BETWEEN 1 AND 5),
    CONSTRAINT fk_reg_paciente
        FOREIGN KEY (paciente_id) REFERENCES pacientes (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_registros_paciente ON registros_emocionales (paciente_id);
CREATE INDEX idx_registros_fecha    ON registros_emocionales (fecha);

-- ------------------------------------------------------------
-- cuestionarios
-- ------------------------------------------------------------
CREATE TABLE cuestionarios (
    id          SERIAL PRIMARY KEY,
    titulo      VARCHAR(200) NOT NULL,
    descripcion TEXT
);

-- ------------------------------------------------------------
-- preguntas
-- ------------------------------------------------------------
CREATE TABLE preguntas (
    id              SERIAL PRIMARY KEY,
    cuestionario_id INT NOT NULL,
    texto           TEXT NOT NULL,
    tipo            tipo_pregunta NOT NULL,
    orden           SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_preg_cuestionario
        FOREIGN KEY (cuestionario_id) REFERENCES cuestionarios (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_preguntas_cuestionario ON preguntas (cuestionario_id);

-- ------------------------------------------------------------
-- respuestas
-- ------------------------------------------------------------
CREATE TABLE respuestas (
    id          SERIAL PRIMARY KEY,
    paciente_id INT NOT NULL,
    pregunta_id INT NOT NULL,
    valor       TEXT NOT NULL,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_resp_paciente
        FOREIGN KEY (paciente_id) REFERENCES pacientes (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_resp_pregunta
        FOREIGN KEY (pregunta_id) REFERENCES preguntas (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_respuestas_paciente ON respuestas (paciente_id);
CREATE INDEX idx_respuestas_pregunta ON respuestas (pregunta_id);

-- ------------------------------------------------------------
-- Datos iniciales
-- ------------------------------------------------------------
INSERT INTO usuarios (nombre, email, contrasena, rol) VALUES
    ('Dra. Laura García', 'laura@mindlink.com', '$2b$12$HASH_AQUI', 'profesional'),
    ('Carlos Martínez',   'carlos@mindlink.com', '$2b$12$HASH_AQUI', 'paciente');

INSERT INTO profesionales (usuario_id, especialidad) VALUES (1, 'Psicología Clínica');
INSERT INTO pacientes (usuario_id, fecha_nacimiento, telefono, profesional_id) VALUES
    (2, '1995-04-20', '612345678', 1);