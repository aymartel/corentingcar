// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { migrateCarStatusParking } from './seed.js';
import { hashPin } from '../utils/pin.js';

/** Recrea `car_status_events` con el CHECK VIEJO (solo user1/user2). */
function useLegacyCarStatusTable(): void {
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS car_status_events');
  db.exec(`
    CREATE TABLE car_status_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      status      TEXT NOT NULL CHECK (status IN ('free','taken')),
      parking     TEXT CHECK (parking IN ('user1','user2')),
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  db.pragma('foreign_keys = ON');
}

function insertEvent(status: string, parking: string | null, note: string | null): void {
  db.prepare(
    'INSERT INTO car_status_events (user_id, status, parking, note) VALUES (1, ?, ?, ?)',
  ).run(status, parking, note);
}

beforeEach(() => {
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS car_status_events');
  db.exec('DROP TABLE IF EXISTS users');
  db.pragma('foreign_keys = ON');
  migrate(db); // esquema nuevo (car_status_events ya admite 'other')
  db.prepare('INSERT INTO users (name, profile, pin_hash, color) VALUES (?, ?, ?, ?)').run(
    'Andy',
    'user1',
    hashPin('1234'),
    '#9CC93B',
  );
});

describe('migrateCarStatusParking', () => {
  it('reconstruye el CHECK para admitir parking=other (conserva eventos)', () => {
    useLegacyCarStatusTable();
    insertEvent('free', 'user1', 'plaza 12');

    migrateCarStatusParking(db);

    // El evento existente se conserva intacto.
    expect(db.prepare('SELECT status, parking, note FROM car_status_events WHERE id = 1').get()).toEqual(
      { status: 'free', parking: 'user1', note: 'plaza 12' },
    );
    // Ahora admite 'other'.
    expect(() => insertEvent('free', 'other', 'garaje del trabajo')).not.toThrow();
    // Sigue rechazando valores no válidos.
    expect(() => insertEvent('free', 'xxx', null)).toThrow();
  });

  it('es idempotente: si la tabla ya admite other, no cambia nada', () => {
    insertEvent('free', 'other', 'x'); // la tabla del esquema nuevo ya lo permite
    migrateCarStatusParking(db);
    expect((db.prepare('SELECT COUNT(*) AS c FROM car_status_events').get() as { c: number }).c).toBe(1);
  });
});
