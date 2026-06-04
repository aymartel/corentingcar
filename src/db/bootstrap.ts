import { pathToFileURL } from 'node:url';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

/**
 * Deja la base de datos lista para arrancar el servidor:
 *  - ejecuta la migración (idempotente, segura en cada arranque),
 *  - aplica el seed SOLO si la BD está vacía (no duplica usuarios ni pisa PIN existentes).
 * Pensado para correr en el arranque del contenedor/servicio (ver index.ts y B9).
 */
export function ensureDatabaseReady(database: typeof db = db): void {
  migrate(database);
  const { count } = database.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  if (count === 0) {
    seed(database);
    console.log('🌱 Base de datos vacía: seed inicial aplicado (Andy/Amigo + rules).');
  } else {
    console.log(`✔ Base de datos lista (${count} usuarios).`);
  }
}

// Ejecutable directamente: `pnpm db:bootstrap`.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureDatabaseReady();
}
