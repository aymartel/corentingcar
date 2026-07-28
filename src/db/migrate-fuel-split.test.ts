// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { migrateFuelSplit } from './seed.js';
import { hashPin } from '../utils/pin.js';

/** Recrea `fuel_logs` SIN las columnas del reparto por km (esquema antiguo). */
function useLegacyFuelTable(): void {
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS fuel_logs');
  db.exec(`
    CREATE TABLE fuel_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      date        TEXT NOT NULL,
      amount_eur  REAL NOT NULL CHECK (amount_eur >= 0),
      type        TEXT NOT NULL CHECK (type IN ('individual','shared')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  db.pragma('foreign_keys = ON');
}

function columnNames(): string[] {
  return (db.prepare('PRAGMA table_info(fuel_logs)').all() as { name: string }[]).map((c) => c.name);
}

beforeEach(() => {
  db.pragma('foreign_keys = OFF');
  db.exec('DROP TABLE IF EXISTS fuel_logs');
  db.exec('DROP TABLE IF EXISTS users');
  // La BD en memoria se comparte dentro del fichero: sin este DROP, los planes de otros
  // tests sobrevivirían y contaminarían la resolución del cupo.
  db.exec('DROP TABLE IF EXISTS mileage_plans');
  db.pragma('foreign_keys = ON');
  migrate(db); // esquema nuevo (fuel_logs ya trae las columnas del reparto)
  db.prepare('INSERT INTO users (name, profile, pin_hash, color) VALUES (?, ?, ?, ?)').run(
    'Andy',
    'user1',
    hashPin('1234'),
    '#9CC93B',
  );
});

describe('migrateFuelSplit', () => {
  it('añade las columnas del reparto por km y conserva las filas antiguas (a NULL)', () => {
    useLegacyFuelTable();
    db.prepare(`INSERT INTO fuel_logs (user_id, date, amount_eur, type) VALUES (1, '2026-01-10', 60, 'shared')`).run();
    expect(columnNames()).not.toContain('payer_share_eur');

    migrateFuelSplit(db);

    const cols = columnNames();
    expect(cols).toEqual(
      expect.arrayContaining([
        'split_method',
        'payer_share_eur',
        'odometer_km',
        'km_user1',
        'km_user2',
      ]),
    );
    // La fila existente se conserva; las columnas nuevas quedan a NULL (saldo legacy por 'type').
    const row = db
      .prepare('SELECT amount_eur, split_method, payer_share_eur FROM fuel_logs WHERE id = 1')
      .get() as { amount_eur: number; split_method: string | null; payer_share_eur: number | null };
    expect(row.amount_eur).toBe(60);
    expect(row.split_method).toBeNull();
    expect(row.payer_share_eur).toBeNull();
  });

  it('es idempotente: si las columnas ya existen, no hace nada', () => {
    // El esquema nuevo (del beforeEach) ya trae las columnas.
    expect(columnNames()).toContain('payer_share_eur');
    expect(() => migrateFuelSplit(db)).not.toThrow();
    expect(columnNames().filter((c) => c === 'payer_share_eur')).toHaveLength(1);
  });
});
