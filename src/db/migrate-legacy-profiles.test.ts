// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { migrateLegacyProfiles } from './seed.js';
import { hashPin } from '../utils/pin.js';

/** Recrea la tabla `users` con el CHECK VIEJO (andy/amigo) para simular la BD legacy. */
function useLegacyUsersTable(): void {
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS users');
  db.exec(`
    CREATE TABLE users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      profile     TEXT NOT NULL UNIQUE CHECK (profile IN ('andy','amigo')),
      pin_hash    TEXT NOT NULL,
      color       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  db.pragma('foreign_keys = ON');
}

function insertUser(name: string, profile: string, pin: string, color: string): void {
  db.prepare(
    'INSERT INTO users (id, name, profile, pin_hash, color) VALUES (NULL, ?, ?, ?, ?)',
  ).run(name, profile, hashPin(pin), color);
}

function profiles(): string[] {
  return (db.prepare('SELECT profile FROM users ORDER BY id').all() as { profile: string }[]).map(
    (r) => r.profile,
  );
}

beforeEach(() => {
  // Tabla `users` limpia y con el esquema nuevo antes de cada test.
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS users');
  db.pragma('foreign_keys = ON');
  migrate(db); // recrea users (esquema nuevo user1/user2); el resto es no-op
});

describe('migrateLegacyProfiles', () => {
  it('remapea andy/amigo → user1/user2 conservando id, pin, nombre y color', () => {
    useLegacyUsersTable();
    insertUser('Andy', 'andy', '1234', '#9CC93B');
    insertUser('Dennis', 'amigo', '5678', '#FF8A3D');
    // hashPin usa salt aleatorio → capturamos el hash original para comparar.
    const hashBefore = (
      db.prepare("SELECT pin_hash FROM users WHERE profile = 'amigo'").get() as {
        pin_hash: string;
      }
    ).pin_hash;

    migrateLegacyProfiles(db);

    expect(profiles()).toEqual(['user1', 'user2']);
    const u2 = db
      .prepare("SELECT id, name, color, pin_hash FROM users WHERE profile = 'user2'")
      .get() as { id: number; name: string; color: string; pin_hash: string };
    expect(u2.id).toBe(2);
    expect(u2.name).toBe('Dennis');
    expect(u2.color).toBe('#FF8A3D');
    expect(u2.pin_hash).toBe(hashBefore); // PIN intacto (hash original conservado)

    // La tabla nueva ya solo admite user1/user2.
    expect(() => insertUser('X', 'andy', '0000', null as unknown as string)).toThrow();
  });

  it('es idempotente: BD ya migrada (user1/user2) no cambia nada', () => {
    insertUser('Andy', 'user1', '1234', '#9CC93B');
    insertUser('Dennis', 'user2', '5678', '#FF8A3D');

    migrateLegacyProfiles(db);

    expect(profiles()).toEqual(['user1', 'user2']);
  });
});
