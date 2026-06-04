/**
 * Cálculo PURO de kilómetros por persona (todo en km). El backend agrega los datos y aplica:
 *  - km individuales: suman enteros a su persona,
 *  - km compartidos: se reparten 50/50 (no se cargan a una sola persona),
 *  - exceso: lo que supera el cupo anual por persona (lo paga quien lo genera).
 */

/** Redondeo a `decimals` decimales (estable frente a ruido de coma flotante). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Parte de km compartidos que corresponde a cada persona (50/50), redondeada. */
export function sharedPerPerson(sharedTotalKm: number, decimals: number): number {
  return roundTo(sharedTotalKm / 2, decimals);
}

export interface PersonMileage {
  usedKm: number;
  remainingKm: number;
  exceeded: boolean;
  excessKm: number;
}

/** Resumen de km de una persona dado su km individual y su parte de compartidos. */
export function personMileage(
  individualKm: number,
  sharedShareKm: number,
  annualKmPerPerson: number,
): PersonMileage {
  const usedKm = roundTo(individualKm + sharedShareKm, 6);
  const remainingKm = roundTo(annualKmPerPerson - usedKm, 6);
  const excessKm = roundTo(Math.max(0, usedKm - annualKmPerPerson), 6);
  return { usedKm, remainingKm, exceeded: excessKm > 0, excessKm };
}
