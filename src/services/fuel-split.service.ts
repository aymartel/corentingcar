import { db } from '../db/connection.js';
import { getRules } from './rules.service.js';
import { listUsers, getOtherUserId } from './users.service.js';
import { sharedPerPerson } from './mileage.core.js';
import { splitFuelByKm } from './expenses.core.js';
import type { UserDto } from '../models/user.js';

/** Reparto de gasolina por persona: km del periodo y € que le toca asumir. */
export interface FuelSplitPerUser {
  user: UserDto;
  km: number;
  shareEur: number;
}

export interface FuelSplitResult {
  /** Odómetro del repostaje anterior (cota inferior EXCLUSIVA); `null` si es el primer repostaje. */
  windowStartKm: number | null;
  /** Odómetro de este repostaje (cota superior INCLUSIVA). */
  windowEndKm: number;
  /** `true` si no había km en el periodo y se repartió 50/50. */
  fallback: boolean;
  /** Reparto por usuario (orden estable por id: user1, user2). */
  perUser: FuelSplitPerUser[];
  /** Parte (€) que asume quien paga (`payerUserId`). */
  payerShareEur: number;
  /** Importe redondeado a 2 decimales (lo que se persistirá). */
  amountEur: number;
}

interface UsageRangeRow {
  userId: number;
  startKm: number;
  endKm: number;
  type: 'individual' | 'shared';
}

/**
 * Km que cada usuario hizo en la ventana de odómetro `(lowerKm, upperKm]`: individuales 100% a su
 * persona, compartidos 50/50. Se cuenta el SOLAPE de cada uso `[start_km, end_km]` con la ventana,
 * de modo que un viaje a caballo de un repostaje aporta solo su parte dentro del tramo. La cota
 * inferior es el odómetro del repostaje anterior (0 si es el primero).
 */
function kmByUserInOdometerWindow(lowerKm: number, upperKm: number): Map<number, number> {
  // Trae los usos que solapan con (lowerKm, upperKm].
  const rows = db
    .prepare(
      `SELECT user_id AS userId, start_km AS startKm, end_km AS endKm, type
       FROM usage_logs
       WHERE end_km > @lowerKm AND start_km < @upperKm`,
    )
    .all({ lowerKm, upperKm }) as UsageRangeRow[];

  let sharedTotal = 0;
  const individualByUser = new Map<number, number>();
  for (const r of rows) {
    const overlap = Math.min(r.endKm, upperKm) - Math.max(r.startKm, lowerKm);
    if (overlap <= 0) continue;
    if (r.type === 'shared') {
      sharedTotal += overlap;
    } else {
      individualByUser.set(r.userId, (individualByUser.get(r.userId) ?? 0) + overlap);
    }
  }

  const share = sharedPerPerson(sharedTotal, getRules().sharedKmRounding);
  const result = new Map<number, number>();
  for (const user of listUsers()) {
    result.set(user.id, (individualByUser.get(user.id) ?? 0) + share);
  }
  return result;
}

/**
 * Calcula el reparto de un repostaje proporcional a los km que hizo cada persona DESDE el último
 * repostaje, usando el ODÓMETRO como eje (ventana `(odómetro anterior, odómetro de este]`). Esto es
 * exacto e independiente de fechas/horas, alineado con el odómetro continuo del coche. Fuente ÚNICA
 * usada por el preview y por el alta, para que lo mostrado en vivo coincida con lo que se persiste.
 *
 * El repostaje anterior es el de MAYOR odómetro estrictamente menor que `odometerKm`; así la recta
 * del odómetro queda particionada en tramos sin solapes ni huecos aunque se registren desordenados.
 */
export function computeFuelSplit(
  payerUserId: number,
  odometerKm: number,
  amountEur: number,
): FuelSplitResult {
  const prevRow = db
    .prepare(
      `SELECT odometer_km AS odo FROM fuel_logs
       WHERE odometer_km IS NOT NULL AND odometer_km < ?
       ORDER BY odometer_km DESC LIMIT 1`,
    )
    .get(odometerKm) as { odo: number } | undefined;
  const windowStartKm = prevRow?.odo ?? null;

  const kmByUser = kmByUserInOdometerWindow(windowStartKm ?? 0, odometerKm);
  const otherUserId = getOtherUserId(payerUserId);
  const kmPayer = kmByUser.get(payerUserId) ?? 0;
  const kmOther = kmByUser.get(otherUserId) ?? 0;

  const { payerShareEur, otherShareEur, fallback } = splitFuelByKm(amountEur, kmPayer, kmOther);

  const perUser: FuelSplitPerUser[] = listUsers().map((user) => ({
    user,
    km: kmByUser.get(user.id) ?? 0,
    shareEur: user.id === payerUserId ? payerShareEur : otherShareEur,
  }));

  return {
    windowStartKm,
    windowEndKm: odometerKm,
    fallback,
    perUser,
    payerShareEur,
    amountEur: payerShareEur + otherShareEur,
  };
}
