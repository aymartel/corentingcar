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
import { todayInTimezone, daysInMonth } from '../utils/date.js';
import type { UserDto } from '../models/user.js';

export interface PersonMileageDto extends PersonMileage {
  user: UserDto;
  individualKm: number;
}

/** Uso vs aconsejado de un mes concreto (para la barra/carrusel mensual). */
export interface MonthMileageDto {
  /** Mes `YYYY-MM`. */
  month: string;
  /** Km aconsejados por persona ese mes (prorrateado a hoy si es el mes en curso). */
  recommendedPerPerson: number;
  /** Km usados por persona ese mes (individual + su parte de compartidos). */
  perUser: { userId: number; used: number }[];
}

export interface MileageSummary {
  kmWindow: string;
  windowStart: string;
  windowEnd: string;
  annualKmTotal: number;
  annualKmPerPerson: number;
  sharedKm: number;
  sharedKmPerPerson: number;
  // --- Ritmo aconsejado (el cupo se acumula dentro del año) ---
  /** Fecha del primer uso registrado (inicio del cómputo); `null` si no hay usos. */
  kmStartDate: string | null;
  /** Cupo aconsejado por persona y mes (= anual / 12) y por día (referencia). */
  monthlyKmPerPerson: number;
  dailyKmPerPerson: number;
  /** Km aconsejados por persona ACUMULADOS en el AÑO en curso hasta hoy (barra anual, reinicio 1 ene). */
  recommendedYearToDate: number;
  perUser: PersonMileageDto[];
  /** Uso vs aconsejado de cada mes registrado (barra mensual / carrusel, reinicio día 1). */
  months: MonthMileageDto[];
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

  // Inicio del cómputo = fecha del PRIMER uso registrado.
  const firstUse = db.prepare('SELECT MIN(date) AS start FROM usage_logs').get() as {
    start: string | null;
  };
  const kmStartDate = firstUse.start;

  const monthlyKmPerPerson = Math.round(rules.annualKmPerPerson / 12);
  const dailyKmPerPerson = roundTo(monthlyKmPerPerson / dim, 1);

  // Aconsejado ACUMULADO del AÑO a hoy (barra anual; se reinicia el 1 de enero). Arranca en el
  // primer uso si es de este año; si no, en el 1 de enero.
  const yearStartForRec = kmStartDate && kmStartDate > windowStart ? kmStartDate : windowStart;
  const recommendedYearToDate = kmStartDate
    ? recommendedAllowanceToDate(yearStartForRec, today, monthlyKmPerPerson)
    : 0;

  const perUser: PersonMileageDto[] = listUsers().map((user) => {
    const individualKm = individualByUser.get(user.id) ?? 0;
    return { user, individualKm, ...personMileage(individualKm, share, rules.annualKmPerPerson) };
  });

  // Uso vs aconsejado por MES (barra mensual / carrusel; se reinicia el día 1 de cada mes).
  const months: MonthMileageDto[] = [];
  if (kmStartDate) {
    const users = listUsers();
    let y = Number(kmStartDate.slice(0, 4));
    let m = Number(kmStartDate.slice(5, 7));
    const endY = Number(today.slice(0, 4));
    const endM = Number(today.slice(5, 7));
    while (y < endY || (y === endY && m <= endM)) {
      const mm = `${y}-${String(m).padStart(2, '0')}`;
      const monthStart = `${mm}-01`;
      const monthEndFull = `${mm}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
      const rangeStart = kmStartDate > monthStart ? kmStartDate : monthStart;
      const rangeEnd = today < monthEndFull ? today : monthEndFull;
      const usedByUser = usedKmByUserInWindow('substr(date, 1, 7) = ?', [mm], rules.sharedKmRounding);
      months.push({
        month: mm,
        recommendedPerPerson: recommendedAllowanceToDate(rangeStart, rangeEnd, monthlyKmPerPerson),
        perUser: users.map((u) => ({ userId: u.id, used: usedByUser.get(u.id) ?? 0 })),
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  return {
    kmWindow: rules.kmWindow,
    windowStart,
    windowEnd,
    annualKmTotal: rules.annualKmTotal,
    annualKmPerPerson: rules.annualKmPerPerson,
    sharedKm: sharedTotal,
    sharedKmPerPerson: share,
    kmStartDate,
    monthlyKmPerPerson,
    dailyKmPerPerson,
    recommendedYearToDate,
    perUser,
    months,
  };
}
