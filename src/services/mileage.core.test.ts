import { describe, it, expect } from 'vitest';
import { roundTo, sharedPerPerson, personMileage } from './mileage.core.js';

const LIMIT = 8000;

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
      remainingKm: 7850,
      exceeded: false,
      excessKm: 0,
    });
  });

  it('marca exceso al superar el cupo anual', () => {
    const r = personMileage(8000, 100, LIMIT); // 8100 usados
    expect(r.usedKm).toBe(8100);
    expect(r.exceeded).toBe(true);
    expect(r.excessKm).toBe(100);
    expect(r.remainingKm).toBe(-100);
  });

  it('justo en el límite no marca exceso', () => {
    const r = personMileage(8000, 0, LIMIT);
    expect(r.exceeded).toBe(false);
    expect(r.excessKm).toBe(0);
    expect(r.remainingKm).toBe(0);
  });
});

describe('roundTo', () => {
  it('redondea sin ruido de coma flotante', () => {
    expect(roundTo(0.1 + 0.2, 1)).toBe(0.3);
    expect(roundTo(50.55, 1)).toBe(50.6);
  });
});
