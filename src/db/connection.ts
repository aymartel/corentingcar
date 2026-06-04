import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

/**
 * Conexión única (singleton) a SQLite vía better-sqlite3. Activa las PRAGMA recomendadas.
 * `DATABASE_PATH` viene del entorno (en producción apunta a un volumen, ver B9).
 */
let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  // Asegurar que existe la carpeta del archivo (p.ej. ./data) salvo para :memory:.
  if (env.DATABASE_PATH !== ':memory:') {
    const dir = dirname(env.DATABASE_PATH);
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }
  }

  instance = new Database(env.DATABASE_PATH);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}

/** Instancia compartida lista para usar en repositorios/servicios. */
export const db = getDb();
