import { describe, it, expect } from 'vitest';
import {
  roundTo,
  sharedPerPerson,
  personMileage,
  recommendedAllowanceToDate,
} from './mileage.core.js';

const LIMIT = 7500;

describe('sharedPerPerson (reparto 50/50)', () => {
  it('reparte los km compartidos a la mitad', () => {
    expect(sharedPerPerson(100, 1)).toBe(50);
    expect(sharedPerPerson(0, 1)).toBe(0);
  });
  it('respeta el redondeo configurado', () => {
    expect(sharedPerPerson(101, 1)).toBe(50.5);
    expect(sharedPerPerson(101, 0)).toBe(51); // 50.5 -> 51 con 0 decimales
  });
});

describe('personMileage', () => {
  it('individual 100 + compartido 100 → esa persona usa 150', () => {
    // 100 individual + (100/2)=50 de compartido
    expect(personMileage(100, 50, LIMIT)).toEqual({
      usedKm: 150,
      remainingKm: 7350,
      exceeded: false,
      excessKm: 0,
    });
  });

  it('marca exceso al superar el cupo anual', () => {
    const r = personMileage(7500, 100, LIMIT); // 7600 usados
    expect(r.usedKm).toBe(7600);
    expect(r.exceeded).toBe(true);
    expect(r.excessKm).toBe(100);
    expect(r.remainingKm).toBe(-100);
  });

  it('justo en el límite no marca exceso', () => {
    const r = personMileage(7500, 0, LIMIT);
    expect(r.exceeded).toBe(false);
    expect(r.excessKm).toBe(0);
    expect(r.remainingKm).toBe(0);
  });
});

describe('recommendedAllowanceToDate (cupo acumulado, 625/mes)', () => {
  it('mismo día de inicio → 1 día prorrateado del mes', () => {
    // 625 * (1/30) = 20.83 → 20.8
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-10', 625)).toBe(20.8);
  });

  it('parte del mes de inicio (10→30 jun = 21 días de 30)', () => {
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-30', 625)).toBe(437.5);
  });

  it('acumula meses: 10 jun → 31 jul = parte de junio + julio entero', () => {
    // 437.5 (junio 21/30) + 625 (julio entero) = 1062.5
    expect(recommendedAllowanceToDate('2026-06-10', '2026-07-31', 625)).toBe(1062.5);
  });

  it('fecha anterior al inicio → 0', () => {
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-09', 625)).toBe(0);
  });
});

describe('roundTo', () => {
  it('redondea sin ruido de coma flotante', () => {
    expect(roundTo(0.1 + 0.2, 1)).toBe(0.3);
    expect(roundTo(50.55, 1)).toBe(50.6);
  });
});
