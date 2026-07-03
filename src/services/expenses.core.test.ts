import { describe, it, expect } from 'vitest';
import { computeBalance, nextWash, round2, splitFuelByKm } from './expenses.core.js';

const A = 1; // Andy
const B = 2; // Dennis

describe('computeBalance', () => {
  it('gasto compartido: el otro debe la mitad a quien pagó', () => {
    // A paga 60 € compartido → B le debe 30 €
    const bal = computeBalance([{ userId: A, amountEur: 60, type: 'shared' }], A, B);
    expect(bal.settled).toBe(false);
    expect(bal.fromUserId).toBe(B);
    expect(bal.toUserId).toBe(A);
    expect(bal.amountEur).toBe(30);
    expect(bal.totalPerUser).toEqual([
      { userId: A, totalEur: 60 },
      { userId: B, totalEur: 0 },
    ]);
  });

  it('gasto individual: no genera deuda', () => {
    const bal = computeBalance([{ userId: A, amountEur: 40, type: 'individual' }], A, B);
    expect(bal.settled).toBe(true);
    expect(bal.fromUserId).toBeNull();
    expect(bal.amountEur).toBe(0);
  });

  it('mezcla: compensa deudas en ambos sentidos', () => {
    // A paga 60 compartido (B debe 30 a A); B paga 20 compartido (A debe 10 a B)
    // Neto: B debe 20 a A
    const bal = computeBalance(
      [
        { userId: A, amountEur: 60, type: 'shared' },
        { userId: B, amountEur: 20, type: 'shared' },
      ],
      A,
      B,
    );
    expect(bal.fromUserId).toBe(B);
    expect(bal.toUserId).toBe(A);
    expect(bal.amountEur).toBe(20);
    expect(bal.totalPerUser).toEqual([
      { userId: A, totalEur: 60 },
      { userId: B, totalEur: 20 },
    ]);
  });

  it('sin entradas: saldado', () => {
    const bal = computeBalance([], A, B);
    expect(bal.settled).toBe(true);
    expect(bal.totalPerUser).toEqual([
      { userId: A, totalEur: 0 },
      { userId: B, totalEur: 0 },
    ]);
  });

  it('importes con decimales (reparto de impar)', () => {
    // A paga 25 compartido → B debe 12.5 a A
    const bal = computeBalance([{ userId: A, amountEur: 25, type: 'shared' }], A, B);
    expect(bal.fromUserId).toBe(B);
    expect(bal.amountEur).toBe(12.5);
  });

  it('combina gasolina y otros gastos en un único saldo', () => {
    // Gasolina: A paga 60 compartido (B debe 30 a A).
    // Otro: B paga 20 compartido (A debe 10 a B).
    // Neto combinado: B debe 20 a A. La función es agnóstica a la fuente.
    const bal = computeBalance(
      [
        { userId: A, amountEur: 60, type: 'shared' }, // fuel
        { userId: B, amountEur: 20, type: 'shared' }, // other
      ],
      A,
      B,
    );
    expect(bal.fromUserId).toBe(B);
    expect(bal.toUserId).toBe(A);
    expect(bal.amountEur).toBe(20);
  });

  it('otro gasto individual no genera deuda', () => {
    const bal = computeBalance([{ userId: B, amountEur: 9.9, type: 'individual' }], A, B);
    expect(bal.settled).toBe(true);
    expect(bal.amountEur).toBe(0);
  });

  it('payerShareEur (reparto por km) sobreescribe el 50/50 del tipo', () => {
    // A paga 100 € pero solo asume 30 (hizo menos km) → B debe 70 a A (no 50).
    const bal = computeBalance(
      [{ userId: A, amountEur: 100, type: 'shared', payerShareEur: 30 }],
      A,
      B,
    );
    expect(bal.fromUserId).toBe(B);
    expect(bal.toUserId).toBe(A);
    expect(bal.amountEur).toBe(70);
  });

  it('mezcla payerShareEur (gasolina) con type (otros) en un único saldo', () => {
    // Gasolina: A paga 100, asume 30 → B debe 70 a A.
    // Otro: B paga 20 compartido 50/50 → A debe 10 a B. Neto: B debe 60 a A.
    const bal = computeBalance(
      [
        { userId: A, amountEur: 100, type: 'shared', payerShareEur: 30 },
        { userId: B, amountEur: 20, type: 'shared' },
      ],
      A,
      B,
    );
    expect(bal.fromUserId).toBe(B);
    expect(bal.toUserId).toBe(A);
    expect(bal.amountEur).toBe(60);
  });
});

describe('splitFuelByKm', () => {
  it('reparte proporcional a los km', () => {
    const s = splitFuelByKm(100, 30, 70);
    expect(s).toEqual({ payerShareEur: 30, otherShareEur: 70, fallback: false });
  });

  it('las dos partes suman EXACTO el importe aunque haya residuo de céntimo', () => {
    const s = splitFuelByKm(100, 1, 2); // 33.33 / 66.67
    expect(s.payerShareEur).toBe(33.33);
    expect(s.otherShareEur).toBe(66.67);
    expect(round2(s.payerShareEur + s.otherShareEur)).toBe(100);
    expect(s.fallback).toBe(false);
  });

  it('sin km en el periodo → 50/50 con fallback', () => {
    const s = splitFuelByKm(50, 0, 0);
    expect(s).toEqual({ payerShareEur: 25, otherShareEur: 25, fallback: true });
  });

  it('fallback con importe impar reparte el céntimo y suma exacto', () => {
    const s = splitFuelByKm(25.01, 0, 0);
    expect(round2(s.payerShareEur + s.otherShareEur)).toBe(25.01);
    expect(s.fallback).toBe(true);
  });

  it('un solo conductor asume todo', () => {
    const s = splitFuelByKm(80, 80, 0);
    expect(s).toEqual({ payerShareEur: 80, otherShareEur: 0, fallback: false });
  });
});

describe('nextWash (alternancia compensada)', () => {
  it('sin historial → usa el primer lavado configurado (owed 1)', () => {
    expect(nextWash(0, 0, null, A, B, A)).toEqual({ nextUserId: A, owed: 1 });
    expect(nextWash(0, 0, null, A, B, B)).toEqual({ nextUserId: B, owed: 1 });
  });

  it('equilibrado con historial → alternancia normal (owed 1)', () => {
    // Cada uno 1 lavado, el último fue A → le toca a B.
    expect(nextWash(1, 1, A, A, B, A)).toEqual({ nextUserId: B, owed: 1 });
    expect(nextWash(1, 1, B, A, B, A)).toEqual({ nextUserId: A, owed: 1 });
  });

  it('Andy lava dos veces seguidas → a Dennis le tocan 2 seguidas', () => {
    // A=2, B=0 (Andy lavó de más) → le toca a B (Dennis) 2 veces para equilibrar.
    expect(nextWash(2, 0, A, A, B, A)).toEqual({ nextUserId: B, owed: 2 });
  });

  it('tras compensar una, sigue debiendo la otra', () => {
    // A=2, B=1 → a B le queda 1 (owed 1).
    expect(nextWash(2, 1, B, A, B, A)).toEqual({ nextUserId: B, owed: 1 });
  });
});

describe('round2', () => {
  it('redondea euros a 2 decimales sin ruido', () => {
    expect(round2(30.005)).toBe(30.01);
    expect(round2(12.5)).toBe(12.5);
  });
});
