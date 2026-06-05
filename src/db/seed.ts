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
  { name: 'Andy', profile: 'andy', pin: process.env.ANDY_PIN ?? '1234', color: '#9CC93B' },
  { name: 'Dennis', profile: 'dennis', pin: process.env.DENNIS_PIN ?? '5678', color: '#FF8A3D' },
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

    const andy = database.prepare(`SELECT id FROM users WHERE profile = 'andy'`).get() as
      | UserIdRow
      | undefined;
    const dennis = database.prepare(`SELECT id FROM users WHERE profile = 'dennis'`).get() as
      | UserIdRow
      | undefined;
    if (!andy || !dennis) {
      throw new Error('No se pudieron sembrar los usuarios (andy/dennis).');
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
        anchor_user_id: andy.id, // Andy tiene prioridad en la fecha ancla
        first_wash_user_id: andy.id, // primer lavado por defecto
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

// Ejecutable directamente: `pnpm db:seed`.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  seed();
  console.log('✅ Seed aplicado (usuarios Andy/Dennis + configuración rules).');
}
