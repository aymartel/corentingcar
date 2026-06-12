// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/connection.js';
import { seed } from '../db/seed.js';
import { computeFuelSplit } from './fuel-split.service.js';

let user1Id: number;
let user2Id: number;

function insertUsage(
  userId: number,
  startKm: number,
  endKm: number,
  type: 'individual' | 'shared',
): void {
  db.prepare(
    `INSERT INTO usage_logs (user_id, date, start_km, end_km, total_km, type)
     VALUES (?, '2026-01-01', ?, ?, ?, ?)`,
  ).run(userId, startKm, endKm, endKm - startKm, type);
}

function insertFuel(userId: number, odometerKm: number, amountEur: number): void {
  db.prepare(
    `INSERT INTO fuel_logs (user_id, date, amount_eur, type, odometer_km)
     VALUES (?, '2026-01-01', ?, 'shared', ?)`,
  ).run(userId, amountEur, odometerKm);
}

beforeEach(() => {
  for (const t of ['usage_logs', 'fuel_logs', 'rules', 'sessions', 'users']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  seed(db); // migra + siembra los 2 usuarios y la fila rules
  const users = db.prepare('SELECT id, profile FROM users ORDER BY id').all() as {
    id: number;
    profile: string;
  }[];
  user1Id = users.find((u) => u.profile === 'user1')!.id;
  user2Id = users.find((u) => u.profile === 'user2')!.id;
});

describe('computeFuelSplit (ventana por odómetro)', () => {
  it('primer repostaje: reparte por todos los km hasta el odómetro (individual + mitad de compartido)', () => {
    insertUsage(user1Id, 0, 100, 'individual'); // 100 km solo Andy
    insertUsage(user1Id, 100, 200, 'shared'); // 100 km compartidos → 50 c/u

    const split = computeFuelSplit(user1Id, 200, 60);

    expect(split.windowStartKm).toBeNull(); // no había repostaje anterior
    expect(split.windowEndKm).toBe(200);
    expect(split.fallback).toBe(false);
    const km = Object.fromEntries(split.perUser.map((p) => [p.user.profile, p.km]));
    expect(km.user1).toBe(150); // 100 individual + 50 de compartido
    expect(km.user2).toBe(50);
    expect(split.payerShareEur).toBe(45); // 60 * 150/200
    const share = Object.fromEntries(split.perUser.map((p) => [p.user.profile, p.shareEur]));
    expect(share.user1).toBe(45);
    expect(share.user2).toBe(15);
  });

  it('solo cuenta los km DESDE el último repostaje (ventana acotada por el odómetro anterior)', () => {
    insertUsage(user1Id, 0, 100, 'individual'); // antes del repostaje previo → NO cuenta
    insertFuel(user1Id, 100, 50); // repostaje anterior a odómetro 100
    insertUsage(user2Id, 100, 300, 'individual'); // dentro de la ventana → cuenta

    const split = computeFuelSplit(user2Id, 300, 50);

    expect(split.windowStartKm).toBe(100);
    expect(split.windowEndKm).toBe(300);
    expect(split.fallback).toBe(false);
    const km = Object.fromEntries(split.perUser.map((p) => [p.user.profile, p.km]));
    expect(km.user1).toBe(0); // su uso quedó antes de la ventana
    expect(km.user2).toBe(200);
    expect(split.payerShareEur).toBe(50); // Dennis (pagador) hizo todos los km
  });

  it('un viaje a caballo del repostaje aporta solo la parte dentro de la ventana', () => {
    insertFuel(user1Id, 1000, 40); // repostaje anterior a odómetro 1000
    insertUsage(user1Id, 950, 1100, 'individual'); // 150 km, pero solo 100 caen tras el odómetro 1000

    const split = computeFuelSplit(user1Id, 1200, 30);

    expect(split.windowStartKm).toBe(1000);
    const km = Object.fromEntries(split.perUser.map((p) => [p.user.profile, p.km]));
    expect(km.user1).toBe(100); // 1000→1100, no los 950→1000 (ya eran del tramo anterior)
    expect(km.user2).toBe(0);
  });

  it('sin km en la ventana → 50/50 con fallback', () => {
    const split = computeFuelSplit(user1Id, 500, 40);
    expect(split.fallback).toBe(true);
    const share = Object.fromEntries(split.perUser.map((p) => [p.user.profile, p.shareEur]));
    expect(share.user1).toBe(20);
    expect(share.user2).toBe(20);
  });
});
