/**
 * Esquema SQLite del dominio (en inglés, según el contrato). Idempotente: usa
 * `CREATE TABLE IF NOT EXISTS`, por lo que puede ejecutarse en cada arranque (ver B9).
 * Se mantiene como cadena (no como archivo .sql) para que viaje con la build a `dist/`.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  profile     TEXT NOT NULL UNIQUE CHECK (profile IN ('user1','user2')),
  pin_hash    TEXT NOT NULL,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_fee_eur       REAL NOT NULL,
  fee_split_pct         REAL NOT NULL,
  annual_km_total       INTEGER NOT NULL,
  annual_km_per_person  INTEGER NOT NULL,
  km_window             TEXT NOT NULL,
  shared_km_rounding    INTEGER NOT NULL,
  anchor_date           TEXT NOT NULL,
  anchor_user_id        INTEGER NOT NULL REFERENCES users(id),
  first_wash_user_id    INTEGER NOT NULL REFERENCES users(id),
  timezone              TEXT NOT NULL,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  start_km    INTEGER NOT NULL,
  end_km      INTEGER NOT NULL CHECK (end_km >= start_km),
  total_km    INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('individual','shared')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_date ON usage_logs(date);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  date            TEXT NOT NULL,
  amount_eur      REAL NOT NULL CHECK (amount_eur >= 0),
  type            TEXT NOT NULL CHECK (type IN ('individual','shared')),
  -- Reparto por km desde el último repostaje (NULL en filas antiguas → saldo por 'type').
  -- 'km' = proporcional a km; 'fallback_5050' = sin km en el periodo, repartido 50/50.
  split_method    TEXT CHECK (split_method IS NULL OR split_method IN ('km','fallback_5050')),
  payer_share_eur REAL,     -- parte (€) que asume quien pagó (user_id)
  odometer_km     INTEGER,  -- km del cuadro al repostar; define la ventana del reparto
  km_user1        REAL,     -- snapshot de km de user1 en la ventana
  km_user2        REAL,     -- snapshot de km de user2 en la ventana
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_user ON fuel_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_date ON fuel_logs(date);

-- Pagos directos entre los 2 usuarios (saldar cuentas), sin vincular a un gasto.
-- Ajustan el saldo combinado: un pago de A→B reduce lo que A debe a B (o aumenta lo que B debe a A).
CREATE TABLE IF NOT EXISTS settlements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id  INTEGER NOT NULL REFERENCES users(id),
  to_user_id    INTEGER NOT NULL REFERENCES users(id),
  date          TEXT NOT NULL,
  amount_eur    REAL NOT NULL CHECK (amount_eur > 0),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_settlements_date ON settlements(date);

CREATE TABLE IF NOT EXISTS wash_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  cost_eur    REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wash_logs_date ON wash_logs(date);

CREATE TABLE IF NOT EXISTS other_expense_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  amount_eur  REAL NOT NULL CHECK (amount_eur >= 0),
  type        TEXT NOT NULL CHECK (type IN ('individual','shared')),
  description TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_other_expense_logs_user ON other_expense_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_other_expense_logs_date ON other_expense_logs(date);

CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id  INTEGER NOT NULL REFERENCES users(id),
  recipient_id  INTEGER NOT NULL REFERENCES users(id),
  use_date      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','cancelled')),
  message       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_use_date ON requests(use_date);
-- Impide una segunda solicitud 'pending' del mismo solicitante para la misma fecha (ver B7).
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_pending_unique
  ON requests(requester_id, use_date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS handovers (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  date                        TEXT NOT NULL UNIQUE,
  effective_priority_user_id  INTEGER NOT NULL REFERENCES users(id),
  origin                      TEXT NOT NULL
                              CHECK (origin IN ('manual','request_accepted','one_off_change')),
  request_id                  INTEGER REFERENCES requests(id),
  created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Disponibilidad en tiempo real ("¿está libre ahora?"). El estado actual = último evento.
-- parking = en casa de qué persona se dejó aparcado (los 2 parqueos fijos).
CREATE TABLE IF NOT EXISTS car_status_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('free','taken')),
  parking     TEXT CHECK (parking IN ('user1','user2','other')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_car_status_created ON car_status_events(id);

-- Cambios de uso que requieren aprobación del otro usuario (ver "historial de usos").
-- Un cambio puede ser: crear un uso pasado desincronizado del odómetro, editar un uso
-- existente o eliminarlo. Mientras está 'pending' NO afecta a usage_logs ni al odómetro.
-- usage_id va SIN FOREIGN KEY a propósito: con foreign_keys=ON, una FK haría fallar el
-- DELETE de un uso (al aprobar una eliminación) por las filas históricas que lo referencian,
-- o anularía la referencia. Se guarda además un snapshot prev_* para renderizar el histórico.
CREATE TABLE IF NOT EXISTS usage_change_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id  INTEGER NOT NULL REFERENCES users(id),
  recipient_id  INTEGER NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL CHECK (kind IN ('create','update','delete')),
  usage_id      INTEGER,
  user_id       INTEGER REFERENCES users(id),
  date          TEXT,
  start_km      INTEGER CHECK (start_km IS NULL OR start_km >= 0),
  end_km        INTEGER CHECK (end_km IS NULL OR start_km IS NULL OR end_km >= start_km),
  type          TEXT CHECK (type IS NULL OR type IN ('individual','shared')),
  prev_user_id  INTEGER,
  prev_date     TEXT,
  prev_start_km INTEGER,
  prev_end_km   INTEGER,
  prev_type     TEXT,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT,
  -- Campos obligatorios según el tipo de cambio.
  CHECK (
    (kind = 'delete' AND usage_id IS NOT NULL)
    OR (kind = 'update' AND usage_id IS NOT NULL AND user_id IS NOT NULL AND date IS NOT NULL
        AND start_km IS NOT NULL AND end_km IS NOT NULL AND type IS NOT NULL)
    OR (kind = 'create' AND usage_id IS NULL AND user_id IS NOT NULL AND date IS NOT NULL
        AND start_km IS NOT NULL AND end_km IS NOT NULL AND type IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_usage_changes_status ON usage_change_requests(status);
-- Un único cambio pendiente por registro de uso (update/delete). Los 'create' (usage_id NULL) no limitan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_changes_pending_unique
  ON usage_change_requests(usage_id) WHERE status = 'pending' AND usage_id IS NOT NULL;
`;
