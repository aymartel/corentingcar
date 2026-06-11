import { describe, it, expect } from 'vitest';
import { computeBalance, nextWashUserId, round2 } from './expenses.core.js';

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
});

describe('nextWashUserId (alternancia)', () => {
  it('sin historial → usa el primer lavado configurado', () => {
    expect(nextWashUserId(null, A, B, A)).toBe(A);
    expect(nextWashUserId(null, A, B, B)).toBe(B);
  });
  it('último A → le toca a B; último B → le toca a A', () => {
    expect(nextWashUserId(A, A, B, A)).toBe(B);
    expect(nextWashUserId(B, A, B, A)).toBe(A);
  });
});

describe('round2', () => {
  it('redondea euros a 2 decimales sin ruido', () => {
    expect(round2(30.005)).toBe(30.01);
    expect(round2(12.5)).toBe(12.5);
  });
});
