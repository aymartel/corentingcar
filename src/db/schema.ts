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
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  amount_eur  REAL NOT NULL CHECK (amount_eur >= 0),
  type        TEXT NOT NULL CHECK (type IN ('individual','shared')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_user ON fuel_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_date ON fuel_logs(date);

CREATE TABLE IF NOT EXISTS wash_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  cost_eur    REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wash_logs_date ON wash_logs(date);

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
`;
