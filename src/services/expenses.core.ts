import type { EntryType } from '../models/entry-type.js';

/**
 * Cálculo PURO de gastos (importes en €).
 *  - Gasto individual: lo asume entero quien pagó.
 *  - Gasto compartido: se divide 50/50 (el otro debe la mitad a quien pagó).
 *  - Lavado: alterna uno cada uno; el próximo se deriva del último registrado.
 */

/** Redondeo monetario a 2 decimales (estable frente a ruido de coma flotante). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface BalanceEntry {
  userId: number;
  amountEur: number;
  type: EntryType;
  /**
   * Parte (€) que asume QUIEN PAGÓ (`userId`); el resto lo asume el otro. Si se indica,
   * SOBREESCRIBE el reparto por `type` (lo usa la gasolina repartida por km). Si es
   * `undefined`, se aplica la lógica por `type` (individual entero / shared 50/50).
   */
  payerShareEur?: number;
}

export interface FuelSplit {
  /** Parte (€) que asume quien pagó. */
  payerShareEur: number;
  /** Parte (€) que asume el otro. `payerShareEur + otherShareEur === round2(amountEur)`. */
  otherShareEur: number;
  /** `true` si no había km en el periodo y se repartió 50/50. */
  fallback: boolean;
}

/**
 * Reparte un importe de gasolina proporcionalmente a los km de cada persona desde el último
 * repostaje. `otherShareEur` se deriva por resta para garantizar que las dos partes sumen EXACTO
 * el importe (sin descuadre de céntimos). Si no hay km en el periodo (`kmPayer + kmOther <= 0`),
 * se reparte 50/50 y se marca `fallback`.
 */
export function splitFuelByKm(amountEur: number, kmPayer: number, kmOther: number): FuelSplit {
  const amount = round2(amountEur);
  const totalKm = kmPayer + kmOther;
  let payerShareEur: number;
  let fallback = false;
  if (totalKm <= 0) {
    payerShareEur = round2(amount / 2);
    fallback = true;
  } else {
    payerShareEur = round2((amount * kmPayer) / totalKm);
  }
  const otherShareEur = round2(amount - payerShareEur);
  return { payerShareEur, otherShareEur, fallback };
}

export interface Balance {
  /** Total pagado de su bolsillo por cada usuario. */
  totalPerUser: { userId: number; totalEur: number }[];
  /** ¿Está saldada la cuenta? */
  settled: boolean;
  /** Deudor (quien debe) — null si está saldada. */
  fromUserId: number | null;
  /** Acreedor (a quien se debe) — null si está saldada. */
  toUserId: number | null;
  /** Importe que `fromUserId` debe a `toUserId` (>= 0). */
  amountEur: number;
}

/**
 * Balance de gastos compartibles (gasolina + otros) entre los 2 usuarios. Para cada persona
 * compara lo que PAGÓ con lo que le CORRESPONDE asumir (su parte): individual la asume entera
 * quien pagó; compartida se reparte 50/50. La diferencia indica quién debe a quién. La función
 * es agnóstica a la fuente: acepta entradas de cualquier tabla de gasto.
 */
export function computeBalance(
  entries: BalanceEntry[],
  userAId: number,
  userBId: number,
): Balance {
  let paidA = 0;
  let paidB = 0;
  let shareA = 0;
  let shareB = 0;

  for (const entry of entries) {
    const isA = entry.userId === userAId;
    if (isA) paidA += entry.amountEur;
    else paidB += entry.amountEur;

    if (entry.payerShareEur != null) {
      // Reparto explícito (gasolina por km): quien pagó asume `payerShareEur`, el otro el resto.
      const otherShare = entry.amountEur - entry.payerShareEur;
      if (isA) {
        shareA += entry.payerShareEur;
        shareB += otherShare;
      } else {
        shareB += entry.payerShareEur;
        shareA += otherShare;
      }
    } else if (entry.type === 'shared') {
      shareA += entry.amountEur / 2;
      shareB += entry.amountEur / 2;
    } else if (isA) {
      shareA += entry.amountEur;
    } else {
      shareB += entry.amountEur;
    }
  }

  const balanceA = round2(paidA - shareA); // > 0: A pagó de más (le deben)

  let settled = false;
  let fromUserId: number | null = null;
  let toUserId: number | null = null;
  let amountEur = 0;

  if (balanceA > 0) {
    fromUserId = userBId;
    toUserId = userAId;
    amountEur = balanceA;
  } else if (balanceA < 0) {
    fromUserId = userAId;
    toUserId = userBId;
    amountEur = round2(-balanceA);
  } else {
    settled = true;
  }

  return {
    totalPerUser: [
      { userId: userAId, totalEur: round2(paidA) },
      { userId: userBId, totalEur: round2(paidB) },
    ],
    settled,
    fromUserId,
    toUserId,
    amountEur,
  };
}

/**
 * Usuario al que le toca el PRÓXIMO lavado (alternancia derivada del historial):
 *  - si no hay lavados todavía → `firstWashUserId` (configurado en rules),
 *  - si el último lo hizo X → le toca al otro.
 */
export function nextWashUserId(
  lastWashUserId: number | null,
  userAId: number,
  userBId: number,
  firstWashUserId: number,
): number {
  if (lastWashUserId == null) return firstWashUserId;
  return lastWashUserId === userAId ? userBId : userAId;
}
