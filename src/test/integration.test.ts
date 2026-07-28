// IMPORTANTE: este import debe ir el PRIMERO para fijar DATABASE_PATH=:memory: antes de
// que se cargue la conexión a la BD.
import './use-memory-db.js';

import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { db } from '../db/connection.js';
import { seed } from '../db/seed.js';
import { monthOfIso, nextMonth, todayInTimezone } from '../utils/date.js';

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
  it('gasolina se reparte por km y genera deuda; el lavado alterna', async () => {
    // Estado de km del mismo archivo: odómetro 0→200 (Andy 0→100 individual, 100→200 compartido).
    // Repostaje a odómetro 200 → ventana (0, 200]: Andy 150 km, Dennis 50 km.
    // 60 € repartidos por km → Andy asume 45, Dennis 15 → Dennis debe 15 a Andy (no 50/50).
    await api('POST', '/api/fuel', {
      token: user1Token,
      body: { date: '2026-01-10', amountEur: 60, odometerKm: 200 },
    });
    const exp1 = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp1).fuel.balance.fromUser.profile).toBe('user2'); // Dennis debe...
    expect(data(exp1).fuel.balance.toUser.profile).toBe('user1'); // ...a Andy
    expect(data(exp1).fuel.balance.amountEur).toBe(15);
    // El reparto por km se persiste y se expone en el historial.
    const fuelEntry = data(exp1).fuel.list[0];
    expect(fuelEntry.split.method).toBe('km');
    expect(fuelEntry.split.payerShareEur).toBe(45); // Andy (pagador) asume 45 €
    const splitSum = fuelEntry.split.perUser.reduce((s: number, p: any) => s + p.shareEur, 0);
    expect(splitSum).toBe(60); // las partes suman exacto el importe

    // Sin lavados aún → próximo = first_wash (Andy).
    expect(data(exp1).wash.nextWashUser.profile).toBe('user1');

    // Andy lava con coste 12 € → próximo pasa a Dennis Y el coste cuenta como gasto compartido.
    await api('POST', '/api/washes', { token: user1Token, body: { date: '2026-01-11', costEur: 12 } });
    const exp2 = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp2).wash.last.user.profile).toBe('user1');
    expect(data(exp2).wash.nextWashUser.profile).toBe('user2');
    // El lavado (12 €, Andy) es compartido → Dennis suma 6 € a Andy: 15 + 6 = 21.
    expect(data(exp2).balance.fromUser.profile).toBe('user2');
    expect(data(exp2).balance.amountEur).toBe(21);
    expect(data(exp2).wash.owedWashes).toBe(1); // equilibrado tras 1 lavado

    // Andy vuelve a lavar (sin coste) → lavó dos veces seguidas: a Dennis le tocan 2.
    await api('POST', '/api/washes', { token: user1Token, body: { date: '2026-01-11' } });
    const exp3 = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp3).wash.nextWashUser.profile).toBe('user2');
    expect(data(exp3).wash.owedWashes).toBe(2); // acumula: Dennis debe lavar 2 veces
    expect(data(exp3).balance.amountEur).toBe(21); // 2º lavado sin coste no cambia el saldo
  });

  it('otro gasto compartido se reconcilia con la gasolina en un único saldo', async () => {
    // Estado previo (mismo archivo): gasolina (Dennis debía 15) + lavado 12 € compartido (Dennis +6) = Dennis debe 21.
    // Dennis paga ahora 20 € de "otro" compartido 50/50 (Andy le debería 10). Neto: Dennis debe 11 a Andy.
    const created = await api('POST', '/api/other-expenses', {
      token: user2Token,
      body: { date: '2026-01-12', amountEur: 20, type: 'shared', description: 'Peaje' },
    });
    expect(created.status).toBe(201);
    expect(data(created).description).toBe('Peaje');
    expect(data(created).type).toBe('shared');

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    // Sección de otros gastos.
    expect(data(exp).other.list[0].description).toBe('Peaje');
    expect(data(exp).other.list[0].user.profile).toBe('user2');
    const otherByProfile = Object.fromEntries(
      data(exp).other.totalPerUser.map((t: any) => [t.user.profile, t.totalEur]),
    );
    expect(otherByProfile.user2).toBe(20);
    expect(otherByProfile.user1).toBe(0);

    // Saldo combinado top-level: Dennis (user2) debe 11 € a Andy (15 gasolina + 6 lavado − 10 otro).
    expect(data(exp).balance.fromUser.profile).toBe('user2');
    expect(data(exp).balance.toUser.profile).toBe('user1');
    expect(data(exp).balance.amountEur).toBe(11);
    // `fuel.balance` es alias del combinado (compatibilidad con clientes antiguos).
    expect(data(exp).fuel.balance.amountEur).toBe(data(exp).balance.amountEur);
  });

  it('un pago directo entre usuarios salda el balance combinado', async () => {
    // Estado previo (mismo archivo): Dennis (user2) debe 11 € a Andy (user1).
    const users = data(await api('GET', '/api/users')) as { id: number; profile: string }[];
    const andy = users.find((u) => u.profile === 'user1')!.id;
    const dennis = users.find((u) => u.profile === 'user2')!.id;

    const created = await api('POST', '/api/settlements', {
      token: user2Token,
      body: { fromUserId: dennis, toUserId: andy, amountEur: 11, date: '2026-01-13', note: 'Bizum' },
    });
    expect(created.status).toBe(201);
    expect(data(created).fromUserId).toBe(dennis);

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    // El pago de 11 € de Dennis a Andy salda la deuda combinada.
    expect(data(exp).balance.settled).toBe(true);
    expect(data(exp).settlements.list).toHaveLength(1);
    expect(data(exp).settlements.list[0].fromUser.profile).toBe('user2');
    expect(data(exp).settlements.list[0].toUser.profile).toBe('user1');
    expect(data(exp).settlements.list[0].note).toBe('Bizum');
  });

  it('borrar un pago revierte su efecto en el balance', async () => {
    const list = data(await api('GET', '/api/expenses', { token: user1Token })).settlements.list as {
      id: number;
    }[];
    const del = await api('DELETE', `/api/settlements/${list[0].id}`, { token: user2Token });
    expect(del.status).toBe(200);

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    // Sin el pago, vuelve la deuda: Dennis debe 11 € a Andy.
    expect(data(exp).settlements.list).toHaveLength(0);
    expect(data(exp).balance.fromUser.profile).toBe('user2');
    expect(data(exp).balance.amountEur).toBe(11);
  });
});

// Estado de partida heredado del bloque anterior: Dennis (user2) debe 11 € a Andy (user1), sin
// pagos. Este describe DEJA ese mismo estado al terminar (borra sus incidencias), porque los
// describes siguientes cuentan con él.
describe('incidencias (multas, golpes, averías)', () => {
  let incidentId = 0;

  it('una incidencia sin importe se registra y NO mueve el saldo', async () => {
    const created = await api('POST', '/api/incidents', {
      token: user1Token,
      body: {
        date: '2026-07-28',
        kind: 'damage',
        description: 'Rayada puerta trasera en el parking',
        type: 'shared',
      },
    });
    expect(created.status).toBe(201);
    expect(data(created).status).toBe('open');
    expect(data(created).amountEur).toBeNull();
    expect(data(created).reportedBy.profile).toBe('user1');
    expect(data(created).paidBy).toBeNull();
    incidentId = data(created).id as number;

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).incidents.openCount).toBe(1);
    expect(data(exp).incidents.pendingAmountEur).toBe(0);
    expect(data(exp).balance.amountEur).toBe(11); // sin cambios
  });

  it('ponerle importe al editarla sigue sin mover el saldo (solo es una previsión)', async () => {
    const patched = await api('PATCH', `/api/incidents/${incidentId}`, {
      token: user2Token,
      body: { amountEur: 90 },
    });
    expect(patched.status).toBe(200);
    expect(data(patched).amountEur).toBe(90);
    expect(data(patched).status).toBe('open');

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).incidents.pendingAmountEur).toBe(90);
    expect(data(exp).balance.amountEur).toBe(11); // sigue sin contar
  });

  it('resolverla la mete en el saldo una sola vez; resolver de nuevo → 409', async () => {
    // La paga Andy y es compartida → Dennis asume 45 más.
    const resolved = await api('PATCH', `/api/incidents/${incidentId}/resolve`, {
      token: user1Token,
      body: {},
    });
    expect(resolved.status).toBe(200);
    expect(data(resolved).status).toBe('resolved');
    expect(data(resolved).paidBy.profile).toBe('user1');
    expect(data(resolved).resolvedAt).not.toBeNull();

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).incidents.openCount).toBe(0);
    expect(data(exp).incidents.pendingAmountEur).toBe(0);
    expect(data(exp).balance.fromUser.profile).toBe('user2');
    expect(data(exp).balance.amountEur).toBe(56); // 11 + 45

    const again = await api('PATCH', `/api/incidents/${incidentId}/resolve`, {
      token: user2Token,
      body: {},
    });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('INVALID_TRANSITION');
  });

  it('reabrirla saca su importe del saldo', async () => {
    const reopened = await api('PATCH', `/api/incidents/${incidentId}/reopen`, {
      token: user2Token,
    });
    expect(reopened.status).toBe(200);
    expect(data(reopened).status).toBe('open');
    expect(data(reopened).paidBy).toBeNull();

    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).balance.amountEur).toBe(11);

    const again = await api('PATCH', `/api/incidents/${incidentId}/reopen`, { token: user1Token });
    expect(again.status).toBe(409);
  });

  it('individual: si la paga quien NO la generó, el responsable asume el importe íntegro', async () => {
    // Multa de Dennis (responsable) que paga Andy → Dennis le debe los 60 € enteros.
    const users = data(await api('GET', '/api/users')) as { id: number; profile: string }[];
    const dennis = users.find((u) => u.profile === 'user2')!;
    const created = await api('POST', '/api/incidents', {
      token: user1Token,
      body: {
        date: '2026-07-20',
        kind: 'fine',
        description: 'Multa zona azul',
        amountEur: 60,
        type: 'individual',
        responsibleUserId: dennis.id,
      },
    });
    expect(created.status).toBe(201);
    expect(data(created).responsible.profile).toBe('user2');
    const fineId = data(created).id as number;

    await api('PATCH', `/api/incidents/${fineId}/resolve`, { token: user1Token, body: {} });
    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).balance.fromUser.profile).toBe('user2');
    expect(data(exp).balance.amountEur).toBe(71); // 11 + 60 enteros

    // Y borrarla revierte el efecto.
    const del = await api('DELETE', `/api/incidents/${fineId}`, { token: user2Token });
    expect(del.status).toBe(200);
    expect(data(await api('GET', '/api/expenses', { token: user1Token })).balance.amountEur).toBe(11);
  });

  it('individual asumido por quien lo paga: no genera deuda', async () => {
    const created = await api('POST', '/api/incidents', {
      token: user1Token,
      body: {
        date: '2026-07-21',
        kind: 'breakdown',
        description: 'Bombilla fundida',
        amountEur: 25,
        type: 'individual',
      },
    });
    const id = data(created).id as number;
    // Sin responsableUserId, lo asume quien la registró (Andy), que es quien la resuelve/paga.
    expect(data(created).responsible.profile).toBe('user1');

    await api('PATCH', `/api/incidents/${id}/resolve`, { token: user1Token, body: {} });
    expect(data(await api('GET', '/api/expenses', { token: user1Token })).balance.amountEur).toBe(11);

    await api('DELETE', `/api/incidents/${id}`, { token: user1Token });
  });

  it('rechaza cuerpos inválidos y exige sesión', async () => {
    for (const body of [
      { date: '2026-07-28', kind: 'damage', description: '   ', type: 'shared' },
      { date: '2026-07-28', kind: 'ovni', description: 'x', type: 'shared' },
      { date: 'no-fecha', kind: 'damage', description: 'x', type: 'shared' },
      { date: '2026-07-28', kind: 'damage', description: 'x', type: 'shared', amountEur: -1 },
      { date: '2026-07-28', kind: 'damage', description: 'x', type: 'shared', amountEur: 1e999 },
    ]) {
      const r = await api('POST', '/api/incidents', { token: user1Token, body });
      expect(r.status).toBe(400);
      expect(code(r)).toBe('VALIDATION_ERROR');
    }
    // PATCH vacío tampoco vale.
    expect(
      (await api('PATCH', `/api/incidents/${incidentId}`, { token: user1Token, body: {} })).status,
    ).toBe(400);

    expect((await api('GET', '/api/incidents')).status).toBe(401);
    expect((await api('POST', '/api/incidents', { body: {} })).status).toBe(401);
    expect((await api('DELETE', `/api/incidents/${incidentId}`)).status).toBe(401);
  });

  it('limpia el estado para los describes siguientes', async () => {
    const list = data(await api('GET', '/api/incidents', { token: user1Token })) as { id: number }[];
    for (const incident of list) {
      await api('DELETE', `/api/incidents/${incident.id}`, { token: user1Token });
    }
    const exp = await api('GET', '/api/expenses', { token: user1Token });
    expect(data(exp).incidents.list).toHaveLength(0);
    expect(data(exp).balance.amountEur).toBe(11); // el estado heredado, intacto
  });
});

describe('gasolina: preview del reparto por km', () => {
  it('GET /api/fuel/preview reparte el importe y coacciona el query', async () => {
    // Hay un repostaje previo a odómetro 200; pedimos preview a odómetro 250 (ventana 200→250).
    const r = await api('GET', '/api/fuel/preview?amountEur=30&odometerKm=250', { token: user1Token });
    expect(r.status).toBe(200);
    const d = data(r);
    expect(d.amountEur).toBe(30); // amountEur/odometerKm llegan como string y se coaccionan a número
    expect(d.windowEndKm).toBe(250);
    expect(d.perUser).toHaveLength(2);
    expect(typeof d.payerShareEur).toBe('number');
    // Las partes siempre suman EXACTO el importe (haya o no km en el periodo).
    const sum = d.perUser.reduce((s: number, p: any) => s + p.shareEur, 0);
    expect(Math.round(sum * 100) / 100).toBe(30);
  });

  it('amountEur inválido (<= 0) → 400 VALIDATION_ERROR', async () => {
    const r = await api('GET', '/api/fuel/preview?amountEur=-5&odometerKm=250', { token: user1Token });
    expect(r.status).toBe(400);
    expect(code(r)).toBe('VALIDATION_ERROR');
  });
});

describe('historial de usos: cambios con aprobación', () => {
  it('crear uso pasado desincronizado requiere aprobación del otro usuario', async () => {
    // Estado heredado: usage_logs = [0→100 ind user1], [100→200 shared]. MAX(end_km)=200.
    // Uso directo en sincronía (startKm 300 ≥ 200) para abrir un hueco anterior.
    const direct = await api('POST', '/api/usage', {
      token: user2Token,
      body: { date: '2026-02-01', startKm: 300, endKm: 400, type: 'individual' },
    });
    expect(direct.status).toBe(201);

    // Propuesta de uso pasado [200,250): no solapa, pero es anterior al odómetro (400) → aprobación.
    const proposed = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'create', date: '2026-01-15', startKm: 200, endKm: 250, type: 'individual' },
    });
    expect(proposed.status).toBe(201);
    expect(data(proposed).status).toBe('pending');
    expect(data(proposed).kind).toBe('create');
    expect(data(proposed).recipient.profile).toBe('user2'); // recipient = el OTRO usuario
    expect(data(proposed).original).toBeNull();
    const createId = data(proposed).id as number;

    // El pendiente NO mueve el odómetro ni los kilómetros.
    const mBefore = await api('GET', '/api/mileage', { token: user1Token });
    const usedBefore = Object.fromEntries(
      data(mBefore).perUser.map((u: any) => [u.user.profile, u.usedKm]),
    );
    expect(usedBefore.user1).toBe(150);

    // Pendientes: visibles para el recipient (user2), no para el requester (user1).
    const pendDennis = await api('GET', '/api/usage/changes/pending', { token: user2Token });
    const pendAndy = await api('GET', '/api/usage/changes/pending', { token: user1Token });
    expect(data(pendDennis)).toHaveLength(1);
    expect(data(pendAndy)).toHaveLength(0);

    // El requester no puede aprobar su propio cambio.
    const selfApprove = await api('PATCH', `/api/usage/changes/${createId}/approve`, {
      token: user1Token,
    });
    expect(selfApprove.status).toBe(403);
    expect(code(selfApprove)).toBe('FORBIDDEN');

    // El recipient aprueba → se inserta el uso y los kilómetros se actualizan.
    const approved = await api('PATCH', `/api/usage/changes/${createId}/approve`, {
      token: user2Token,
    });
    expect(approved.status).toBe(200);
    expect(data(approved).status).toBe('approved');

    const list = await api('GET', '/api/usage', { token: user1Token });
    const inserted = (data(list) as any[]).find((u) => u.startKm === 200 && u.endKm === 250);
    expect(inserted).toBeTruthy();

    const mAfter = await api('GET', '/api/mileage', { token: user1Token });
    const usedAfter = Object.fromEntries(
      data(mAfter).perUser.map((u: any) => [u.user.profile, u.usedKm]),
    );
    expect(usedAfter.user1).toBe(200); // +50 km individuales del uso aprobado
  });

  it('propuesta que solapa otro registro → 400 ODOMETER_INCONSISTENT', async () => {
    const overlap = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'create', date: '2026-01-20', startKm: 150, endKm: 260, type: 'individual' },
    });
    expect(overlap.status).toBe(400);
    expect(code(overlap)).toBe('ODOMETER_INCONSISTENT');
  });

  it('editar requiere aprobación; un único pendiente por uso; reject/cancel por rol; total recalculado', async () => {
    const list = await api('GET', '/api/usage', { token: user1Token });
    const target = (data(list) as any[]).find((u) => u.startKm === 200 && u.endKm === 250);
    const usageId = target.id as number;

    // user1 edita su propio uso → recipient sigue siendo user2 (el no-solicitante).
    const upd = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'update', usageId, date: '2026-01-15', startKm: 200, endKm: 240, type: 'individual' },
    });
    expect(upd.status).toBe(201);
    expect(data(upd).recipient.profile).toBe('user2');
    expect(data(upd).original.endKm).toBe(250);
    expect(data(upd).proposed.endKm).toBe(240);
    const updId = data(upd).id as number;

    // Segundo pendiente sobre el mismo uso → 409.
    const dup = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'update', usageId, date: '2026-01-15', startKm: 200, endKm: 245, type: 'individual' },
    });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('DUPLICATE_PENDING_CHANGE');

    // El recipient rechaza → el uso no cambia.
    const rejected = await api('PATCH', `/api/usage/changes/${updId}/reject`, { token: user2Token });
    expect(data(rejected).status).toBe('rejected');
    const list2 = await api('GET', '/api/usage', { token: user1Token });
    expect((data(list2) as any[]).find((u) => u.id === usageId).endKm).toBe(250);

    // Nueva propuesta: cancelar solo el requester.
    const upd2 = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'update', usageId, date: '2026-01-15', startKm: 200, endKm: 240, type: 'individual' },
    });
    const upd2Id = data(upd2).id as number;
    const cantCancel = await api('PATCH', `/api/usage/changes/${upd2Id}/cancel`, { token: user2Token });
    expect(cantCancel.status).toBe(403);
    const cancelled = await api('PATCH', `/api/usage/changes/${upd2Id}/cancel`, { token: user1Token });
    expect(data(cancelled).status).toBe('cancelled');

    // Propuesta final aprobada → total_km recalculado en el servidor (240-200=40).
    const upd3 = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'update', usageId, date: '2026-01-15', startKm: 200, endKm: 240, type: 'individual' },
    });
    const upd3Id = data(upd3).id as number;
    const okUpd = await api('PATCH', `/api/usage/changes/${upd3Id}/approve`, { token: user2Token });
    expect(okUpd.status).toBe(200);
    const list3 = await api('GET', '/api/usage', { token: user1Token });
    expect((data(list3) as any[]).find((u) => u.id === usageId).totalKm).toBe(40);

    // Aprobar de nuevo el mismo cambio → transición inválida.
    const again = await api('PATCH', `/api/usage/changes/${upd3Id}/approve`, { token: user2Token });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('INVALID_TRANSITION');
  });

  it('eliminar requiere aprobación y desaparece de los kilómetros', async () => {
    const list = await api('GET', '/api/usage', { token: user1Token });
    const target = (data(list) as any[]).find((u) => u.startKm === 200);
    const usageId = target.id as number;

    // user2 propone eliminar → recipient = user1.
    const del = await api('POST', '/api/usage/changes', {
      token: user2Token,
      body: { kind: 'delete', usageId, reason: 'Duplicado' },
    });
    expect(del.status).toBe(201);
    expect(data(del).kind).toBe('delete');
    expect(data(del).proposed).toBeNull();
    expect(data(del).original.startKm).toBe(200);
    expect(data(del).recipient.profile).toBe('user1');
    const delId = data(del).id as number;

    const approved = await api('PATCH', `/api/usage/changes/${delId}/approve`, { token: user1Token });
    expect(approved.status).toBe(200);

    const list2 = await api('GET', '/api/usage', { token: user1Token });
    expect((data(list2) as any[]).find((u) => u.id === usageId)).toBeUndefined();

    const m = await api('GET', '/api/mileage', { token: user1Token });
    const used = Object.fromEntries(data(m).perUser.map((u: any) => [u.user.profile, u.usedKm]));
    expect(used.user1).toBe(150); // vuelve al valor original
  });

  it('conflicto al aprobar (odómetro movido entremedias) → 409 y el cambio sigue pendiente', async () => {
    // usage_logs = [0,100],[100,200],[300,400]. Dos propuestas que se solapan ENTRE sí.
    const a = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'create', date: '2026-01-25', startKm: 250, endKm: 280, type: 'individual' },
    });
    const b = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'create', date: '2026-01-26', startKm: 260, endKm: 290, type: 'individual' },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Aprobar la primera inserta [250,280].
    const okA = await api('PATCH', `/api/usage/changes/${data(a).id}/approve`, { token: user2Token });
    expect(okA.status).toBe(200);

    // La segunda ahora solapa con [250,280] → 409 y sigue pendiente.
    const conflict = await api('PATCH', `/api/usage/changes/${data(b).id}/approve`, {
      token: user2Token,
    });
    expect(conflict.status).toBe(409);
    expect(code(conflict)).toBe('ODOMETER_INCONSISTENT');
    const stillPending = await api('GET', '/api/usage/changes/pending', { token: user2Token });
    expect((data(stillPending) as any[]).some((c) => c.id === data(b).id)).toBe(true);

    // Limpieza: rechazar la segunda.
    await api('PATCH', `/api/usage/changes/${data(b).id}/reject`, { token: user2Token });
  });

  it('validación: update con endKm < startKm → 400; delete de uso inexistente → 404', async () => {
    const bad = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'update', usageId: 1, date: '2026-01-15', startKm: 200, endKm: 100, type: 'individual' },
    });
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe('VALIDATION_ERROR');

    const ghost = await api('POST', '/api/usage/changes', {
      token: user1Token,
      body: { kind: 'delete', usageId: 999999 },
    });
    expect(ghost.status).toBe(404);
    expect(code(ghost)).toBe('NOT_FOUND');
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

  it('otro gasto sin descripción / vacía / demasiado larga → 400 (otros gastos)', async () => {
    const missing = await api('POST', '/api/other-expenses', {
      token: user1Token,
      body: { date: '2026-02-01', amountEur: 10, type: 'shared' },
    });
    expect(missing.status).toBe(400);
    expect(code(missing)).toBe('VALIDATION_ERROR');

    const empty = await api('POST', '/api/other-expenses', {
      token: user1Token,
      body: { date: '2026-02-01', amountEur: 10, type: 'shared', description: '   ' },
    });
    expect(empty.status).toBe(400);
    expect(code(empty)).toBe('VALIDATION_ERROR');

    const tooLong = await api('POST', '/api/other-expenses', {
      token: user1Token,
      body: { date: '2026-02-01', amountEur: 10, type: 'shared', description: 'x'.repeat(121) },
    });
    expect(tooLong.status).toBe(400);
    expect(code(tooLong)).toBe('VALIDATION_ERROR');
  });
});

// Va al final (antes del rate-limit) porque el último caso usa /api/admin/reset, que borra los
// datos transaccionales de los bloques anteriores.
describe('planes de kilometraje (ajuste del cupo con fecha de efecto)', () => {
  const today = todayInTimezone('Europe/Madrid');
  const currentMonth = monthOfIso(today);
  const effectiveMonth = nextMonth(currentMonth);

  /** Deja la tabla de planes vacía (el estado de partida: solo la línea base de `rules`). */
  function clearPlans(): void {
    db.prepare('DELETE FROM mileage_plans').run();
  }

  it('las rutas exigen sesión (no cuelgan de /rules, que es pública)', async () => {
    expect((await api('GET', '/api/mileage/plans')).status).toBe(401);
    expect(
      (await api('POST', '/api/mileage/plans', { body: { annualKmTotal: 25000, monthlyFeeEur: 425 } }))
        .status,
    ).toBe(401);
    expect((await api('DELETE', '/api/mileage/plans/scheduled')).status).toBe(401);
    // La lectura pública de reglas sí sigue abierta.
    expect((await api('GET', '/api/rules')).status).toBe(200);
  });

  it('sin cambios: plan vigente = línea base y catálogo con los deltas del renting', async () => {
    clearPlans();
    const r = await api('GET', '/api/mileage/plans', { token: user1Token });
    expect(r.status).toBe(200);
    expect(data(r).current.annualKmTotal).toBe(15000);
    expect(data(r).current.monthlyKmTotal).toBe(1250);
    expect(data(r).current.monthlyKmPerPerson).toBe(625);
    expect(data(r).current.effectiveMonth).toBeNull(); // "desde el inicio"
    expect(data(r).scheduled).toBeNull();

    const options = data(r).options as any[];
    expect(options.map((o) => o.annualKmTotal)).toEqual([15000, 20000, 25000]);
    expect(options.map((o) => o.extraFeeEur)).toEqual([0, 30, 70]);
    expect(options.map((o) => o.isCurrent)).toEqual([true, false, false]);
    // 25.000 → 2.083 km/mes entre los dos y 1.041,67 por persona.
    expect(options[2].monthlyKmTotal).toBe(2083);
    expect(options[2].monthlyKmPerPerson).toBe(1041.67);
    expect(options[2].feePerPerson).toBe(212.5);
    expect(options[2].feeDeltaEur).toBe(70);
  });

  it('programar un cambio no mueve la cuota, el cupo del mes ni el ritmo (entra el día 1)', async () => {
    clearPlans();
    const before = await api('GET', '/api/mileage', { token: user1Token });
    const rulesBefore = await api('GET', '/api/rules');

    const posted = await api('POST', '/api/mileage/plans', {
      token: user1Token,
      body: { annualKmTotal: 25000, monthlyFeeEur: 425 },
    });
    expect(posted.status).toBe(201);
    expect(data(posted).scheduled.effectiveMonth).toBe(effectiveMonth);
    expect(data(posted).scheduled.annualKmTotal).toBe(25000);
    expect(data(posted).scheduled.createdBy.profile).toBe('user1'); // queda registrado el autor
    expect(data(posted).current.annualKmTotal).toBe(15000); // hoy sigue el plan viejo

    const after = await api('GET', '/api/mileage', { token: user1Token });
    // El mes en curso mantiene su cupo: los km extra son de los meses que aún no han empezado.
    expect(data(after).currentMonthKmPerPerson).toBe(data(before).currentMonthKmPerPerson);
    expect(data(after).monthlyKmPerPerson).toBe(data(before).monthlyKmPerPerson);
    // Y el ritmo acumulado tampoco cambia: los meses ya transcurridos conservan su plan.
    expect(data(after).recommendedYearToDate).toBe(data(before).recommendedYearToDate);

    // En cambio el CUPO DEL AÑO sí crece ya (bolsa anual única, como en la app del renting:
    // al elegir el escalón te enseña el total nuevo aunque se aplique desde el mes que viene).
    const sameYear = effectiveMonth.slice(0, 4) === currentMonth.slice(0, 4);
    if (sameYear) {
      const monthsAtOldPlan = Number(effectiveMonth.slice(5, 7)) - 1;
      const expectedYear = Math.round(
        monthsAtOldPlan * 625 + (12 - monthsAtOldPlan) * (25000 / 24),
      );
      expect(data(after).yearKmPerPerson).toBe(expectedYear);
    } else {
      // Cambio programado para enero: el año en curso no se toca.
      expect(data(after).yearKmPerPerson).toBe(data(before).yearKmPerPerson);
    }
    expect(data(after).yearKmTotal).toBe(data(after).yearKmPerPerson * 2);

    const rulesAfter = await api('GET', '/api/rules');
    expect(data(rulesAfter).monthlyFeeEur).toBe(data(rulesBefore).monthlyFeeEur);
    expect(data(rulesAfter).annualKmTotal).toBe(15000); // nominal: sigue el plan vigente
    expect(data(rulesAfter).scheduledKmPlan.annualKmTotal).toBe(25000);

    // Reprogramar sustituye al pendiente: nunca hay dos cambios a la vez.
    await api('POST', '/api/mileage/plans', {
      token: user2Token,
      body: { annualKmTotal: 20000, monthlyFeeEur: 385 },
    });
    const rows = db.prepare('SELECT * FROM mileage_plans').all() as { annual_km_total: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].annual_km_total).toBe(20000);

    clearPlans();
  });

  it('ya en vigor: cuota, cupo por persona y cupo del mes pasan al plan nuevo', async () => {
    clearPlans();
    // Se fuerza el efecto insertando la fila con el MES EN CURSO en vez de depender del reloj.
    db.prepare(
      `INSERT INTO mileage_plans (effective_month, annual_km_total, monthly_fee_eur, created_by_user_id)
       VALUES (?, 25000, 425, 1)`,
    ).run(currentMonth);

    const rules = await api('GET', '/api/rules');
    expect(data(rules).monthlyFeeEur).toBe(425);
    expect(data(rules).feePerPerson).toBe(212.5); // derivado de la MISMA cuota, no de rules
    expect(data(rules).annualKmTotal).toBe(25000); // nominal del contrato
    expect(data(rules).kmPlan.monthlyKmTotal).toBe(2083);

    const m = await api('GET', '/api/mileage', { token: user1Token });
    expect(data(m).currentMonthKmTotal).toBe(2083);
    expect(data(m).currentMonthKmPerPerson).toBe(1041.67);
    // Cupo del año MIXTO: los meses anteriores conservan 625 y los que quedan valen 1.041,67.
    const monthsAtOldPlan = Number(currentMonth.slice(5, 7)) - 1;
    const expectedYear = Math.round(monthsAtOldPlan * 625 + (12 - monthsAtOldPlan) * (25000 / 24));
    expect(data(m).yearKmPerPerson).toBe(expectedYear);
    expect(data(m).yearKmTotal).toBe(expectedYear * 2);
    // Las barras cuadran: el total es exactamente el doble del de por persona.
    expect(data(m).annualKmTotal).toBe(data(m).annualKmPerPerson * 2);
    // Los tramos explican el cupo mixto en la UI.
    expect((data(m).yearPlanSegments as any[]).at(-1).annualKmTotal).toBe(25000);

    clearPlans();
  });

  it('cancelar el cambio programado, y cancelar dos veces → 404', async () => {
    clearPlans();
    await api('POST', '/api/mileage/plans', {
      token: user1Token,
      body: { annualKmTotal: 25000, monthlyFeeEur: 425 },
    });

    const cancelled = await api('DELETE', '/api/mileage/plans/scheduled', { token: user1Token });
    expect(cancelled.status).toBe(200);
    expect(data(cancelled).scheduled).toBeNull();

    const again = await api('DELETE', '/api/mileage/plans/scheduled', { token: user1Token });
    expect(again.status).toBe(404);
    expect(code(again)).toBe('NO_SCHEDULED_PLAN');
  });

  it('no se puede borrar el histórico: cancelar no toca un plan ya vigente', async () => {
    clearPlans();
    db.prepare(
      `INSERT INTO mileage_plans (effective_month, annual_km_total, monthly_fee_eur, created_by_user_id)
       VALUES (?, 25000, 425, 1)`,
    ).run(currentMonth);

    const r = await api('DELETE', '/api/mileage/plans/scheduled', { token: user1Token });
    expect(r.status).toBe(404); // no hay nada FUTURO que cancelar
    expect(db.prepare('SELECT COUNT(*) AS n FROM mileage_plans').get()).toEqual({ n: 1 });

    clearPlans();
  });

  it('valida el cuerpo (enteros, sin Infinity, sin negativos)', async () => {
    for (const body of [
      { annualKmTotal: 0, monthlyFeeEur: 355 },
      { annualKmTotal: 15000.5, monthlyFeeEur: 355 },
      { annualKmTotal: 15000, monthlyFeeEur: -1 },
      { annualKmTotal: 15000, monthlyFeeEur: 1e999 },
      { annualKmTotal: '25000', monthlyFeeEur: 425 },
    ]) {
      const r = await api('POST', '/api/mileage/plans', { token: user1Token, body });
      expect(r.status).toBe(400);
      expect(code(r)).toBe('VALIDATION_ERROR');
    }
  });

  it('los campos del contrato antiguo siguen presentes (app ya instalada)', async () => {
    const rules = await api('GET', '/api/rules');
    for (const key of ['monthlyFeeEur', 'feePerPerson', 'annualKmTotal', 'annualKmPerPerson']) {
      expect(data(rules)[key]).toEqual(expect.any(Number));
    }
    const m = await api('GET', '/api/mileage', { token: user1Token });
    for (const key of ['annualKmTotal', 'annualKmPerPerson', 'monthlyKmPerPerson']) {
      expect(data(m)[key]).toEqual(expect.any(Number));
    }
  });

  it('el reset de admin NO borra los planes (es configuración) pero SÍ las incidencias', async () => {
    clearPlans();
    await api('POST', '/api/mileage/plans', {
      token: user1Token,
      body: { annualKmTotal: 25000, monthlyFeeEur: 425 },
    });
    // Una incidencia es dato transaccional: el reset debe llevársela, o dejaría saldo fantasma.
    await api('POST', '/api/incidents', {
      token: user1Token,
      body: { date: '2026-07-28', kind: 'other', description: 'Se borra en el reset', type: 'shared' },
    });

    const reset = await api('POST', '/api/admin/reset', {
      token: user1Token,
      body: { initialKm: 1000, password: 'Pass4admin' },
    });
    expect(reset.status).toBe(200);
    expect(data(reset).clearedTables).toContain('incidents');

    const r = await api('GET', '/api/mileage/plans', { token: user1Token });
    expect(data(r).scheduled.annualKmTotal).toBe(25000);
    expect(data(await api('GET', '/api/incidents', { token: user1Token }))).toHaveLength(0);

    clearPlans();
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
