import { pathToFileURL } from 'node:url';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import {
  migrateCarStatusParking,
  migrateLegacyProfiles,
  reconcileSeedUsers,
  seed,
} from './seed.js';

/**
 * Deja la base de datos lista para arrancar el servidor:
 *  - ejecuta la migración (idempotente, segura en cada arranque),
 *  - aplica el seed SOLO si la BD está vacía (no duplica usuarios ni pisa PIN existentes),
 *  - reconcilia nombre/color de los usuarios con el seed en cada arranque (sin tocar el PIN),
 *    para que cambios de nombre/color se apliquen al re-desplegar sobre una BD existente.
 * Pensado para correr en el arranque del contenedor/servicio (ver index.ts y B9).
 */
export function ensureDatabaseReady(database: typeof db = db): void {
  migrate(database);
  // Renombra perfiles legacy andy/amigo → user1/user2 en BD ya existentes
  // (idempotente; no hace nada si ya están migrados o la BD está vacía).
  migrateLegacyProfiles(database);
  // Amplía el parqueo a 'other' (descripción libre) en BD ya existentes (idempotente).
  migrateCarStatusParking(database);
  const { count } = database.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  if (count === 0) {
    seed(database);
    console.log('🌱 Base de datos vacía: seed inicial aplicado (Andy/Dennis + rules).');
  } else {
    console.log(`✔ Base de datos lista (${count} usuarios).`);
  }
  // Aplica cambios de nombre/color del seed a una BD ya existente (idempotente).
  reconcileSeedUsers(database);
}

// Ejecutable directamente: `pnpm db:bootstrap`.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureDatabaseReady();
}
