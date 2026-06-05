// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/connection.js';
import { seed } from '../db/seed.js';
import { setCarStatus, getCarStatus } from './car-status.service.js';

beforeEach(() => {
  seed(db); // migra + siembra user1 (id 1) / user2 (id 2) + rules
  db.prepare('DELETE FROM car_status_events').run();
});

describe('setCarStatus · disponibilidad exclusiva', () => {
  it('rechaza coger el coche si lo tiene la otra persona', () => {
    setCarStatus(1, { status: 'taken' }); // user1 lo coge
    expect(getCarStatus().status).toBe('taken');

    expect(() => setCarStatus(2, { status: 'taken' })).toThrow(); // user2 no puede

    expect(getCarStatus().user?.id).toBe(1); // sigue en manos de user1
  });

  it('tras liberarlo, la otra persona ya puede cogerlo', () => {
    setCarStatus(1, { status: 'taken' });
    setCarStatus(1, { status: 'free', parking: 'user2' }); // user1 lo deja libre
    expect(getCarStatus().status).toBe('free');

    setCarStatus(2, { status: 'taken' }); // ahora sí
    expect(getCarStatus().user?.id).toBe(2);
  });

  it('el que lo tiene puede re-confirmar (idempotente)', () => {
    setCarStatus(1, { status: 'taken' });
    expect(() => setCarStatus(1, { status: 'taken' })).not.toThrow();
    expect(getCarStatus().user?.id).toBe(1);
  });
});
