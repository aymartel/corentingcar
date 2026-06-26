import { db } from '../db/connection.js';
import { getRules } from './rules.service.js';
import { listUsers } from './users.service.js';
import {
  sharedPerPerson,
  personMileage,
  roundTo,
  recommendedAllowanceToDate,
  type PersonMileage,
} from './mileage.core.js';
import { todayInTimezone, daysInMonth, dayNumberFromIso } from '../utils/date.js';
import type { UserDto } from '../models/user.js';

export interface PersonMileageDto extends PersonMileage {
  user: UserDto;
  individualKm: number;
  /** Km usados por la persona ACUMULADOS desde el primer uso (individual + su parte de compartidos). */
  usedSinceStart: number;
}

export interface MileageSummary {
  kmWindow: string;
  windowStart: string;
  windowEnd: string;
  annualKmTotal: number;
  annualKmPerPerson: number;
  sharedKm: number;
  sharedKmPerPerson: number;
  // --- Ritmo aconsejado ACUMULADO (el cupo se arrastra de un mes a otro) ---
  /** Fecha del primer uso registrado (inicio del cómputo); `null` si no hay usos. */
  kmStartDate: string | null;
  /** Días transcurridos desde el primer uso (inclusive). */
  daysSinceStart: number;
  /** Cupo aconsejado por persona y mes (= anual / 12). */
  monthlyKmPerPerson: number;
  /** Ritmo aconsejado por persona y día (referencia, mensual / días del mes en curso). */
  dailyKmPerPerson: number;
  /** Km aconsejados por persona ACUMULADOS hasta hoy desde el primer uso (cupo arrastrado). */
  recommendedToDate: number;
  perUser: PersonMileageDto[];
}

/**
 * Resumen de km del periodo. Ventana según `rules.km_window` ('natural' = año natural en
 * curso, en la zona horaria de `rules`). Límite y redondeo vienen de `rules` (no hardcodeados).
 */
/** Km usados por persona en una ventana: individual (100%) + su parte de compartidos (50/50). */
function usedKmByUserInWindow(
  where: string,
  params: unknown[],
  rounding: number,
): Map<number, number> {
  const individualRows = db
    .prepare(
      `SELECT user_id AS userId, COALESCE(SUM(total_km), 0) AS km
       FROM usage_logs WHERE type = 'individual' AND ${where} GROUP BY user_id`,
    )
    .all(...params) as { userId: number; km: number }[];
  const individualByUser = new Map(individualRows.map((r) => [r.userId, r.km]));

  const sharedTotal = (
    db
      .prepare(`SELECT COALESCE(SUM(total_km), 0) AS km FROM usage_logs WHERE type = 'shared' AND ${where}`)
      .get(...params) as { km: number }
  ).km;
  const share = sharedPerPerson(sharedTotal, rounding);

  const result = new Map<number, number>();
  for (const user of listUsers()) {
    result.set(user.id, roundTo((individualByUser.get(user.id) ?? 0) + share, rounding));
  }
  return result;
}

export function getMileage(): MileageSummary {
  const rules = getRules();
  const today = todayInTimezone(rules.timezone);
  const year = today.slice(0, 4);
  const dim = daysInMonth(Number(year), Number(today.slice(5, 7)));
  const windowStart = `${year}-01-01`;
  const windowEnd = `${year}-12-31`;

  const individualRows = db
    .prepare(
      `SELECT user_id AS userId, COALESCE(SUM(total_km), 0) AS km
       FROM usage_logs
       WHERE type = 'individual' AND date BETWEEN ? AND ?
       GROUP BY user_id`,
    )
    .all(windowStart, windowEnd) as { userId: number; km: number }[];
  const individualByUser = new Map(individualRows.map((r) => [r.userId, r.km]));

  const sharedTotal = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total_km), 0) AS km
         FROM usage_logs
         WHERE type = 'shared' AND date BETWEEN ? AND ?`,
      )
      .get(windowStart, windowEnd) as { km: number }
  ).km;

  const share = sharedPerPerson(sharedTotal, rules.sharedKmRounding);

  // Inicio del cómputo = fecha del PRIMER uso registrado (el cupo se acumula desde ahí).
  const firstUse = db.prepare('SELECT MIN(date) AS start FROM usage_logs').get() as {
    start: string | null;
  };
  const kmStartDate = firstUse.start;

  // Ritmo aconsejado ACUMULADO: cupo mensual (= anual/12) arrastrado desde el primer uso.
  const monthlyKmPerPerson = Math.round(rules.annualKmPerPerson / 12);
  const dailyKmPerPerson = roundTo(monthlyKmPerPerson / dim, 1);
  const daysSinceStart = kmStartDate
    ? dayNumberFromIso(today) - dayNumberFromIso(kmStartDate) + 1
    : 0;
  const recommendedToDate = kmStartDate
    ? recommendedAllowanceToDate(kmStartDate, today, monthlyKmPerPerson)
    : 0;

  // Uso ACUMULADO por persona desde el primer uso (= todo el uso hasta hoy).
  const usedSinceStartByUser = kmStartDate
    ? usedKmByUserInWindow('date BETWEEN ? AND ?', [kmStartDate, today], rules.sharedKmRounding)
    : new Map<number, number>();

  const perUser: PersonMileageDto[] = listUsers().map((user) => {
    const individualKm = individualByUser.get(user.id) ?? 0;
    return {
      user,
      individualKm,
      usedSinceStart: usedSinceStartByUser.get(user.id) ?? 0,
      ...personMileage(individualKm, share, rules.annualKmPerPerson),
    };
  });

  return {
    kmWindow: rules.kmWindow,
    windowStart,
    windowEnd,
    annualKmTotal: rules.annualKmTotal,
    annualKmPerPerson: rules.annualKmPerPerson,
    sharedKm: sharedTotal,
    sharedKmPerPerson: share,
    kmStartDate,
    daysSinceStart,
    monthlyKmPerPerson,
    dailyKmPerPerson,
    recommendedToDate,
    perUser,
  };
}
