/**
 * Cálculo PURO de kilómetros por persona (todo en km). El backend agrega los datos y aplica:
 *  - km individuales: suman enteros a su persona,
 *  - km compartidos: se reparten 50/50 (no se cargan a una sola persona),
 *  - exceso: lo que supera el cupo anual por persona (lo paga quien lo genera).
 */

import { daysInMonth, dayNumberFromIso } from '../utils/date.js';

/** Redondeo a `decimals` decimales (estable frente a ruido de coma flotante). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Cupo mensual por persona derivado del kilometraje ANUAL contratado, **sin redondear**:
 * anual / 12 meses / 2 personas (25.000 → 1.041,666…). Se redondea una sola vez al final,
 * nunca en medio: dividir el 2.083 ya redondeado entre dos daría 1.041,5 y los 12 meses
 * sumarían 12.498 en vez de 12.500.
 */
export function monthlyPerPersonFromAnnual(annualKmTotal: number): number {
  return annualKmTotal / 24;
}

/**
 * Cupo mensual por persona vigente en un mes concreto (`month1` es 1..12). Recibe año y mes
 * como NÚMEROS a propósito: con una clave `YYYY-MM` olvidar el `padStart` produciría `2026-8`,
 * que no casa con nada y devolvería `undefined` → NaN propagado hasta la app.
 */
export type MonthlyAllowanceLookup = (year: number, month1: number) => number;

/**
 * Km aconsejados ACUMULADOS por persona entre `startIso` y `todayIso` (ambos inclusive),
 * prorrateando por los días cubiertos de cada mes el cupo que estuvo vigente ESE mes. Modela
 * la acumulación de un mes a otro: lo no gastado se arrastra y el exceso resta (el ritmo es
 * continuo desde el primer uso, no se reinicia cada mes). Devuelve 0 si `today` < `start`.
 *
 * Como los cambios de plan siempre entran en vigor el día 1, ningún mes mezcla dos cupos.
 */
export function recommendedAllowanceToDateByMonth(
  startIso: string,
  todayIso: string,
  monthlyPerPerson: MonthlyAllowanceLookup,
): number {
  if (dayNumberFromIso(todayIso) < dayNumberFromIso(startIso)) return 0;
  const sy = Number(startIso.slice(0, 4));
  const sm = Number(startIso.slice(5, 7));
  const sd = Number(startIso.slice(8, 10));
  const ty = Number(todayIso.slice(0, 4));
  const tm = Number(todayIso.slice(5, 7));
  const td = Number(todayIso.slice(8, 10));
  let allowance = 0;
  let y = sy;
  let m = sm;
  while (y < ty || (y === ty && m <= tm)) {
    const dim = daysInMonth(y, m);
    const first = y === sy && m === sm ? sd : 1;
    const last = y === ty && m === tm ? td : dim;
    allowance += monthlyPerPerson(y, m) * ((last - first + 1) / dim);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return roundTo(allowance, 1);
}

/** Igual que [recommendedAllowanceToDateByMonth] con un cupo mensual constante. */
export function recommendedAllowanceToDate(
  startIso: string,
  todayIso: string,
  monthlyPerPerson: number,
): number {
  return recommendedAllowanceToDateByMonth(startIso, todayIso, () => monthlyPerPerson);
}

/**
 * Cupo por persona de un AÑO natural completo: suma los 12 cupos mensuales exactos (meses
 * enteros, sin prorrateo) y redondea UNA sola vez. Con un cambio de plan a mitad de año el
 * resultado es mixto: 2026 con subida a 25.000 desde agosto → 7×625 + 5×1.041,67 = 9.583.
 *
 * El cupo TOTAL del año se deriva siempre como `2 × este valor`, nunca al revés: así la barra
 * total y las dos barras por persona cuadran exactamente.
 */
export function yearAllowancePerPerson(
  year: number,
  monthlyPerPerson: MonthlyAllowanceLookup,
): number {
  let total = 0;
  for (let m = 1; m <= 12; m += 1) {
    total += monthlyPerPerson(year, m);
  }
  return Math.round(total);
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
