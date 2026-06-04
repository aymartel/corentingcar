import { pathToFileURL } from 'node:url';
import { db } from './connection.js';
import { SCHEMA_SQL } from './schema.js';

/** Crea el esquema (idempotente). Reutilizable en tests pasando otra instancia. */
export function migrate(database: typeof db = db): void {
  database.exec(SCHEMA_SQL);
}

// Ejecutable directamente: `pnpm db:migrate`.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  migrate();
  console.log('✅ Migración aplicada (esquema creado/actualizado).');
}
