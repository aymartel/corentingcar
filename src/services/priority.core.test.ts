import { describe, it, expect } from 'vitest';
import { rotationUserId, resolvePriority, conflictPhrase } from './priority.core.js';
import { dayNumberFromIso, daysInMonth, enumerateMonthDays, isValidIsoDate } from '../utils/date.js';

const ANCHOR = '2025-01-01';
const A = 1; // usuario ancla
const B = 2; // el otro

describe('rotationUserId (alternancia diaria)', () => {
  it('el día ancla pertenece al usuario ancla', () => {
    expect(rotationUserId(ANCHOR, A, B, '2025-01-01')).toBe(A);
  });

  it('alterna día a día', () => {
    expect(rotationUserId(ANCHOR, A, B, '2025-01-02')).toBe(B);
    expect(rotationUserId(ANCHOR, A, B, '2025-01-03')).toBe(A);
    expect(rotationUserId(ANCHOR, A, B, '2025-01-04')).toBe(B);
  });

  it('NO se reinicia por semana (depende solo de la paridad desde el ancla)', () => {
    expect(rotationUserId(ANCHOR, A, B, '2025-01-08')).toBe(B); // +7 (impar)
    expect(rotationUserId(ANCHOR, A, B, '2025-01-15')).toBe(A); // +14 (par)
  });

  it('es continua entre meses', () => {
    expect(rotationUserId(ANCHOR, A, B, '2025-01-31')).toBe(A); // +30 (par)
    expect(rotationUserId(ANCHOR, A, B, '2025-02-01')).toBe(B); // +31 (impar)
  });

  it('es simétrica hacia el pasado', () => {
    expect(rotationUserId(ANCHOR, A, B, '2024-12-31')).toBe(B); // -1 (impar)
    expect(rotationUserId(ANCHOR, A, B, '2024-12-30')).toBe(A); // -2 (par)
  });

  it('es inmune al cambio de hora (DST) en Europa', () => {
    // 2025-03-30 fue cambio de hora en Europa; la paridad no debe desplazarse.
    expect(rotationUserId(ANCHOR, A, B, '2025-03-29')).toBe(B); // +87 (impar)
    expect(rotationUserId(ANCHOR, A, B, '2025-03-30')).toBe(A); // +88 (par)
    expect(rotationUserId(ANCHOR, A, B, '2025-03-31')).toBe(B); // +89 (impar)
  });
});

describe('resolvePriority (override de prioridad)', () => {
  it('usa la alternancia cuando no hay handover', () => {
    expect(
      resolvePriority({ date: '2025-01-02', anchorDate: ANCHOR, anchorUserId: A, otherUserId: B }),
    ).toEqual({ userId: B, source: 'rotation' });
  });

  it('el handover tiene prioridad sobre la alternancia', () => {
    expect(
      resolvePriority({
        date: '2025-01-02',
        anchorDate: ANCHOR,
        anchorUserId: A,
        otherUserId: B,
        handoverUserId: A,
      }),
    ).toEqual({ userId: A, source: 'handover' });
  });
});

describe('conflictPhrase', () => {
  it('menciona a la persona con prioridad', () => {
    expect(conflictPhrase('Andy')).toContain('Andy');
    expect(conflictPhrase('Andy')).toMatch(/prioridad/i);
  });
});

describe('utilidades de fecha', () => {
  it('dayNumberFromIso da diferencias exactas en días', () => {
    expect(dayNumberFromIso('2025-01-02') - dayNumberFromIso('2025-01-01')).toBe(1);
    expect(dayNumberFromIso('2025-02-01') - dayNumberFromIso('2025-01-01')).toBe(31);
  });

  it('daysInMonth cuenta bien (incluido febrero bisiesto)', () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 6)).toBe(30);
  });

  it('enumerateMonthDays lista todos los días del mes', () => {
    const days = enumerateMonthDays('2025-02');
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2025-02-01');
    expect(days.at(-1)).toBe('2025-02-28');
  });

  it('isValidIsoDate rechaza fechas inexistentes', () => {
    expect(isValidIsoDate('2025-02-28')).toBe(true);
    expect(isValidIsoDate('2025-02-30')).toBe(false);
    expect(isValidIsoDate('2025-13-01')).toBe(false);
    expect(isValidIsoDate('no-fecha')).toBe(false);
  });
});
