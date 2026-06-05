// IMPORTANTE: este import debe ir el PRIMERO para fijar DATABASE_PATH=:memory: antes de
// que se cargue la conexión a la BD.
import './use-memory-db.js';

import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/connection.js';
import { seed } from '../db/seed.js';

let server: Server;
let base: string;
let user1Token: string;
let user2Token: string;

interface ApiResult {
  status: number;
  json: { ok: boolean; data?: unknown; error?: { code: string; message: string } } | null;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as ApiResult['json'];
  return { status: res.status, json };
}

// Atajos tipados sobre `data`.
const data = (r: ApiResult): any => r.json?.data;
const code = (r: ApiResult): string | undefined => r.json?.error?.code;

async function login(profile: string, pin: string): Promise<string> {
  const r = await api('POST', '/api/auth/login', { body: { profile, pin } });
  return data(r).token as string;
}

beforeAll(async () => {
  // Salvaguarda: jamás tocar la BD real.
  expect(env.DATABASE_PATH).toBe(':memory:');
  seed(db); // migra + siembra Andy/Dennis (PIN 1234/5678) y rules (ancla 2025-01-01 = Andy)

  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  // Tokens capturados ANTES de cualquier prueba de rate-limit.
  user1Token = await login('user1', '1234');
  user2Token = await login('user2', '5678');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('auth', () => {
  it('login con PIN correcto devuelve token + user', () => {
    expect(user1Token).toMatch(/^[a-f0-9]+$/);
    expect(user2Token).toMatch(/^[a-f0-9]+$/);
  });

  it('login con PIN incorrecto → 401', async () => {
    const r = await api('POST', '/api/auth/login', { body: { profile: 'user1', pin: '0000' } });
    expect(r.status).toBe(401);
    expect(code(r)).toBe('INVALID_CREDENTIALS');
  });

  it('endpoint protegido sin token → 401', async () => {
    const r = await api('GET', '/api/priority/today');
    expect(r.status).toBe(401);
    expect(code(r)).toBe('UNAUTHENTICATED');
  });
});

describe('prioridad', () => {
  it('GET /api/priority/today devuelve la persona con prioridad y la frase', async () => {
    const r = await api('GET', '/api/priority/today', { token: user1Token });
    expect(r.status).toBe(200);
    expect(data(r).priorityUser.profile).toMatch(/user1|user2/);
    expect(typeof data(r).conflictPhrase).toBe('string');
    expect(typeof data(r).isMyDay).toBe('boolean');
  });

  it('alternancia: 2025-01-01 = Andy, 2025-01-02 = Dennis', async () => {
    const a = await api('GET', '/api/priority?date=2025-01-01', { token: user1Token });
    const b = await api('GET', '/api/priority?date=2025-01-02', { token: user1Token });
    expect(data(a).priorityUser.profile).toBe('user1');
    expect(data(b).priorityUser.profile).toBe('user2');
  });
});

describe('kilómetros', () => {
  it('individual + compartido reparte 50/50 y valida el odómetro', async () => {
    await api('POST', '/api/usage', {
      token: user1Token,
      body: { date: '2026-01-01', startKm: 0, endKm: 100, type: 'individual' },
    });
    await api('POST', '/api/usage', {
      token: user1Token,
      body: { date: '2026-01-02', startKm: 100, endKm: 200, type: 'shared' },
    });

    const m = await api('GET', '/api/mileage', { token: user1Token });
    const byProfile = Object.fromEntries(data(m).perUser.map((u: any) => [u.user.profile, u.usedKm]));
    expect(byProfile.user1).toBe(150); // 100 individual + 50 (mitad de 100 compartido)
    expect(byProfile.user2).toBe(50);
    expect(data(m).sharedKm).toBe(100);

    // Odómetro inconsistente: startKm por debajo del último end_km.
    const bad = await api('POST', '/api/usage', {
      token: user1Token,
      body: { date: '2026-01-03', startKm: 50, endKm: 120, type: 'individual' },
    });
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe('ODOMETER_INCONSISTENT');
  });
});

describe('solicitudes (pending → accepted) y efecto en prioridad', () => {
  it('Andy pide el día de Dennis, Dennis acepta y la prioridad efectiva cambia', async () => {
    // Día propio → no permitido.
    const own = await api('POST', '/api/requests', {
      token: user1Token,
      body: { useDate: '2025-01-01' },
    });
    expect(code(own)).toBe('CANNOT_REQUEST_OWN_DAY');

    // Día de Dennis → pending, recipient = Dennis.
    const created = await api('POST', '/api/requests', {
      token: user1Token,
      body: { useDate: '2025-01-02', message: 'médico' },
    });
    expect(created.status).toBe(201);
    expect(data(created).status).toBe('pending');
    expect(data(created).recipient.profile).toBe('user2');
    const id = data(created).id as number;

    // Duplicada → 409.
    const dup = await api('POST', '/api/requests', {
      token: user1Token,
      body: { useDate: '2025-01-02' },
    });
    expect(code(dup)).toBe('DUPLICATE_PENDING_REQUEST');

    // Solo el recipient acepta.
    const forbidden = await api('PATCH', `/api/requests/${id}/accept`, { token: user1Token });
    expect(forbidden.status).toBe(403);
    expect(code(forbidden)).toBe('FORBIDDEN');

    // Pendientes dirigidas a Dennis = 1, a Andy = 0.
    const pendDennis = await api('GET', '/api/requests/pending', { token: user2Token });
    const pendAndy = await api('GET', '/api/requests/pending', { token: user1Token });
    expect(data(pendDennis)).toHaveLength(1);
    expect(data(pendAndy)).toHaveLength(0);

    // Dennis acepta → accepted y crea el handover.
    const accepted = await api('PATCH', `/api/requests/${id}/accept`, { token: user2Token });
    expect(accepted.status).toBe(200);
    expect(data(accepted).status).toBe('accepted');

    const prio = await api('GET', '/api/priority?date=2025-01-02', { token: user1Token });
    expect(data(prio).priorityUser.profile).toBe('user1');
    expect(data(prio).source).toBe('handover');

    // Aceptar de nuevo → transición inválida.
    const again = await api('PATCH', `/api/requests/${id}/accept`, { token: user2Token });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('INVALID_TRANSITION');
  });
});

describe('gastos: gasolina (balance) y lavado (alternancia)', () => {
  it('gasolina compartida genera deuda; el lavado alterna', async () => {
    await api('POST', '/api/fuel', {
      token: user1Token,
      body: { date: '2026-01-10', amountEur: 60, type: 'shared' },
    });
    const exp1 = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp1).fuel.balance.fromUser.profile).toBe('user2'); // Dennis debe...
    expect(data(exp1).fuel.balance.toUser.profile).toBe('user1'); // ...a Andy
    expect(data(exp1).fuel.balance.amountEur).toBe(30);

    // Sin lavados aún → próximo = first_wash (Andy).
    expect(data(exp1).wash.nextWashUser.profile).toBe('user1');

    // Andy lava → próximo pasa a Dennis.
    await api('POST', '/api/washes', { token: user1Token, body: { date: '2026-01-11', costEur: 12 } });
    const exp2 = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp2).wash.last.user.profile).toBe('user1');
    expect(data(exp2).wash.nextWashUser.profile).toBe('user2');
  });
});

describe('validación', () => {
  it('body inválido → 400 VALIDATION_ERROR (gasolina)', async () => {
    const r = await api('POST', '/api/fuel', {
      token: user1Token,
      body: { date: 'no-fecha', amountEur: -1, type: 'otro' },
    });
    expect(r.status).toBe(400);
    expect(code(r)).toBe('VALIDATION_ERROR');
  });

  it('importe no finito (Infinity) → 400', async () => {
    const r = await api('POST', '/api/fuel', {
      token: user1Token,
      body: { date: '2026-02-01', amountEur: 1e999, type: 'shared' },
    });
    expect(r.status).toBe(400);
    expect(code(r)).toBe('VALIDATION_ERROR');
  });
});

// Debe ir AL FINAL: contamina el rate-limit del perfil 'user2' (cuyo token ya está capturado).
describe('rate-limit de login', () => {
  it('tras 5 intentos fallidos, el 6º responde 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await api('POST', '/api/auth/login', { body: { profile: 'user2', pin: '0000' } });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
