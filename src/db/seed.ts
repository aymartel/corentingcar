import { pathToFileURL } from 'node:url';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { hashPin } from '../utils/pin.js';

/**
 * Datos de seed. Los PIN se gestionan DIRECTAMENTE aquí (sin pantalla de registro) y se
 * guardan hasheados. Se pueden sobrescribir por variables de entorno para no usar valores
 * por defecto en producción.
 */
const SEED_USERS = [
  { name: 'Andy', profile: 'user1', pin: process.env.USER1_PIN ?? '1234', color: '#9CC93B' },
  { name: 'Dennis', profile: 'user2', pin: process.env.USER2_PIN ?? '5678', color: '#FF8A3D' },
] as const;

/** Fecha ancla de la alternancia de prioridad (configurable). */
const ANCHOR_DATE = process.env.ANCHOR_DATE ?? '2025-01-01';

interface UserIdRow {
  id: number;
}

/** Inserta usuarios y la fila singleton `rules`. Idempotente (ON CONFLICT DO NOTHING). */
export function seed(database: typeof db = db): void {
  migrate(database); // garantizar el esquema antes de sembrar

  const insertUser = database.prepare(
    `INSERT INTO users (name, profile, pin_hash, color)
     VALUES (@name, @profile, @pin_hash, @color)
     ON CONFLICT(profile) DO NOTHING`,
  );

  const runSeed = database.transaction(() => {
    for (const user of SEED_USERS) {
      insertUser.run({
        name: user.name,
        profile: user.profile,
        pin_hash: hashPin(user.pin),
        color: user.color,
      });
    }

    const user1 = database.prepare(`SELECT id FROM users WHERE profile = 'user1'`).get() as
      | UserIdRow
      | undefined;
    const user2 = database.prepare(`SELECT id FROM users WHERE profile = 'user2'`).get() as
      | UserIdRow
      | undefined;
    if (!user1 || !user2) {
      throw new Error('No se pudieron sembrar los usuarios (user1/user2).');
    }

    database
      .prepare(
        `INSERT INTO rules (
           id, monthly_fee_eur, fee_split_pct, annual_km_total, annual_km_per_person,
           km_window, shared_km_rounding, anchor_date, anchor_user_id, first_wash_user_id, timezone
         ) VALUES (
           1, 355.0, 50.0, 16000, 8000,
           'natural', 1, @anchor_date, @anchor_user_id, @first_wash_user_id, 'Europe/Madrid'
         )
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        anchor_date: ANCHOR_DATE,
        anchor_user_id: user1.id, // Andy tiene prioridad en la fecha ancla
        first_wash_user_id: user1.id, // primer lavado por defecto
      });
  });

  runSeed();
}

/**
 * Reconcilia el **nombre** y el **color** de los usuarios con los valores de
 * `SEED_USERS` (fuente única). Idempotente y seguro en cada arranque: NO toca
 * `pin_hash` (el PIN se mantiene). Permite que cambios de nombre/color del seed
 * se apliquen a una BD ya existente en el siguiente despliegue.
 */
export function reconcileSeedUsers(database: typeof db = db): void {
  const update = database.prepare(
    `UPDATE users SET name = @name, color = @color WHERE profile = @profile`,
  );
  const run = database.transaction(() => {
    for (const user of SEED_USERS) {
      update.run({ name: user.name, color: user.color, profile: user.profile });
    }
  });
  run();
}

/**
 * Migración de datos **idempotente**: en una BD sembrada con los perfiles
 * antiguos `andy`/`amigo` (antes de adoptar slugs genéricos), los remapea a
 * `user1`/`user2` conservando id, `pin_hash`, nombre, color y fechas. Tras esto,
 * login con `user1`/`user2` y el PIN intacto.
 *
 * La columna `profile` lleva un `CHECK (profile IN (...))`; como SQLite no permite
 * alterar un CHECK in situ, se **reconstruye** la tabla `users` (crear nueva →
 * copiar con el mapeo → borrar vieja → renombrar). No hace nada si no hay perfiles
 * legacy (BD ya migrada o recién sembrada).
 */
export function migrateLegacyProfiles(database: typeof db = db): void {
  const { c } = database
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE profile IN ('andy', 'amigo')`)
    .get() as { c: number };
  if (c === 0) return; // ya migrada o sin datos legacy

  database.pragma('foreign_keys = OFF');
  try {
    const rebuild = database.transaction(() => {
      database.exec(`
        CREATE TABLE users_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL UNIQUE,
          profile     TEXT NOT NULL UNIQUE CHECK (profile IN ('user1','user2')),
          pin_hash    TEXT NOT NULL,
          color       TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, name, profile, pin_hash, color, created_at)
        SELECT id, name,
          CASE profile WHEN 'andy' THEN 'user1' WHEN 'amigo' THEN 'user2' ELSE profile END,
          pin_hash, color, created_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    });
    rebuild();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

/**
 * Migración **idempotente** del CHECK de `car_status_events.parking` para admitir
 * el parqueo `'other'` (descripción libre). Como SQLite no permite alterar un
 * CHECK in situ, **reconstruye** la tabla conservando los eventos. No hace nada si
 * el CHECK ya incluye `'other'` (o la tabla no existe).
 */
export function migrateCarStatusParking(database: typeof db = db): void {
  const row = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'car_status_events'`)
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'other'")) return; // ya soporta 'other' o no existe

  database.pragma('foreign_keys = OFF');
  try {
    const rebuild = database.transaction(() => {
      database.exec(`
        CREATE TABLE car_status_events_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL REFERENCES users(id),
          status      TEXT NOT NULL CHECK (status IN ('free','taken')),
          parking     TEXT CHECK (parking IN ('user1','user2','other')),
          note        TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO car_status_events_new (id, user_id, status, parking, note, created_at)
          SELECT id, user_id, status, parking, note, created_at FROM car_status_events;
        DROP TABLE car_status_events;
        ALTER TABLE car_status_events_new RENAME TO car_status_events;
        CREATE INDEX IF NOT EXISTS idx_car_status_created ON car_status_events(id);
      `);
    });
    rebuild();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

// Ejecutable directamente: `pnpm db:seed`.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  seed();
  console.log('✅ Seed aplicado (usuarios Andy/Dennis + configuración rules).');
}
