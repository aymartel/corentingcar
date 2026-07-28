import { db } from '../db/connection.js';
import { getRulesRow, getPlanBaseline } from './rules.service.js';
import { buildMonthlyAllowanceLookup, getPlanForMonth } from './mileage-plans.service.js';
import { listUsers } from './users.service.js';
import {
  sharedPerPerson,
  personMileage,
  roundTo,
  recommendedAllowanceToDateByMonth,
  yearAllowancePerPerson,
  monthlyPerPersonFromAnnual,
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
  /**
   * Cupo COMPLETO por persona de ese mes, según el plan que estuvo vigente entonces
   * (625 con 15.000, 1.041,67 con 25.000). Es la escala de la barra mensual: sin él, los meses
   * de planes distintos se dibujarían todos contra la misma referencia.
   */
  budgetPerPerson: number;
  /** Km usados por persona ese mes (individual + su parte de compartidos). */
  perUser: { userId: number; used: number }[];
}

/** Tramo de un año con un plan distinto (para explicar un cupo anual mixto en la UI). */
export interface YearPlanSegmentDto {
  /** Mes inicial y final del tramo (1..12). */
  fromMonth: number;
  toMonth: number;
  annualKmTotal: number;
}

export interface MileageSummary {
  kmWindow: string;
  windowStart: string;
  windowEnd: string;
  /**
   * Cupo EFECTIVO del año natural en curso, que puede ser mixto si hubo un cambio de plan
   * (2026 con subida a 25.000 en agosto → 9.583 por persona, 19.166 en total). Para el
   * NOMINAL del plan contratado (25.000 km/año), ver `GET /api/rules`.
   */
  annualKmTotal: number;
  annualKmPerPerson: number;
  /** Alias explícitos de los dos anteriores, para no confundirlos con el nominal de `rules`. */
  yearKmTotal: number;
  yearKmPerPerson: number;
  sharedKm: number;
  sharedKmPerPerson: number;
  // --- Ritmo aconsejado (el cupo se acumula dentro del año) ---
  /** Fecha del primer uso registrado (inicio del cómputo); `null` si no hay usos. */
  kmStartDate: string | null;
  /** Cupo aconsejado por persona y mes en el mes EN CURSO, redondeado (compatibilidad). */
  monthlyKmPerPerson: number;
  /** Cupo del mes en curso de los dos juntos = anual / 12 (25.000 → 2.083). */
  currentMonthKmTotal: number;
  /** Cupo del mes en curso por persona, con decimales (25.000 → 1.041,67). */
  currentMonthKmPerPerson: number;
  dailyKmPerPerson: number;
  /** Km aconsejados por persona ACUMULADOS en el AÑO en curso hasta hoy (barra anual, reinicio 1 ene). */
  recommendedYearToDate: number;
  perUser: PersonMileageDto[];
  /** Uso vs aconsejado de cada mes registrado (barra mensual / carrusel, reinicio día 1). */
  months: MonthMileageDto[];
  /** Tramos del año si el plan cambió a mitad (vacío o 1 elemento si fue constante). */
  yearPlanSegments: YearPlanSegmentDto[];
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
  const rulesRow = getRulesRow();
  const baseline = getPlanBaseline(rulesRow);
  const sharedKmRounding = rulesRow.shared_km_rounding;
  const today = todayInTimezone(rulesRow.timezone);
  const year = today.slice(0, 4);
  const yearNum = Number(year);
  const monthNum = Number(today.slice(5, 7));
  const dim = daysInMonth(yearNum, monthNum);
  const windowStart = `${year}-01-01`;
  const windowEnd = `${year}-12-31`;

  // Resolutor del cupo mensual por persona: TODAS las filas se cargan una vez y se resuelven
  // en memoria (getMileage recorre N meses; consultar dentro del bucle multiplicaría queries).
  const monthlyLookup = buildMonthlyAllowanceLookup(baseline);

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

  const share = sharedPerPerson(sharedTotal, sharedKmRounding);

  // Inicio del cómputo = fecha del PRIMER uso registrado.
  const firstUse = db.prepare('SELECT MIN(date) AS start FROM usage_logs').get() as {
    start: string | null;
  };
  const kmStartDate = firstUse.start;

  // Cupo del año natural: suma de los 12 cupos mensuales (mixto si hubo cambio de plan).
  // El total se DERIVA del de por persona para que las barras cuadren siempre.
  const yearKmPerPerson = yearAllowancePerPerson(yearNum, monthlyLookup);
  const yearKmTotal = yearKmPerPerson * 2;

  // Cupo del MES en curso (el que enseña el renting: 25.000 → 2.083 y 1.041,67 por persona).
  const currentMonth = `${year}-${String(monthNum).padStart(2, '0')}`;
  const currentAnnualKm = getPlanForMonth(currentMonth, baseline).annualKmTotal;
  const currentMonthKmTotal = Math.round(currentAnnualKm / 12);
  const currentMonthKmPerPerson = roundTo(monthlyPerPersonFromAnnual(currentAnnualKm), 2);
  const monthlyKmPerPerson = Math.round(currentMonthKmPerPerson);
  const dailyKmPerPerson = roundTo(currentMonthKmPerPerson / dim, 1);

  // Aconsejado ACUMULADO del AÑO a hoy (barra anual; se reinicia el 1 de enero). Arranca en el
  // primer uso si es de este año; si no, en el 1 de enero. Cada mes usa SU cupo.
  const yearStartForRec = kmStartDate && kmStartDate > windowStart ? kmStartDate : windowStart;
  const recommendedYearToDate = kmStartDate
    ? recommendedAllowanceToDateByMonth(yearStartForRec, today, monthlyLookup)
    : 0;

  const perUser: PersonMileageDto[] = listUsers().map((user) => {
    const individualKm = individualByUser.get(user.id) ?? 0;
    return { user, individualKm, ...personMileage(individualKm, share, yearKmPerPerson) };
  });

  // Tramos del año con plan distinto (para explicar en la UI un cupo anual mixto).
  const yearPlanSegments: YearPlanSegmentDto[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const annualKmTotal = Math.round(monthlyLookup(yearNum, m) * 24);
    const last = yearPlanSegments[yearPlanSegments.length - 1];
    if (last && last.annualKmTotal === annualKmTotal) {
      last.toMonth = m;
    } else {
      yearPlanSegments.push({ fromMonth: m, toMonth: m, annualKmTotal });
    }
  }

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
      const usedByUser = usedKmByUserInWindow('substr(date, 1, 7) = ?', [mm], sharedKmRounding);
      months.push({
        month: mm,
        recommendedPerPerson: recommendedAllowanceToDateByMonth(rangeStart, rangeEnd, monthlyLookup),
        budgetPerPerson: roundTo(monthlyLookup(y, m), 2),
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
    kmWindow: rulesRow.km_window,
    windowStart,
    windowEnd,
    annualKmTotal: yearKmTotal,
    annualKmPerPerson: yearKmPerPerson,
    yearKmTotal,
    yearKmPerPerson,
    sharedKm: sharedTotal,
    sharedKmPerPerson: share,
    kmStartDate,
    monthlyKmPerPerson,
    currentMonthKmTotal,
    currentMonthKmPerPerson,
    dailyKmPerPerson,
    recommendedYearToDate,
    perUser,
    months,
    yearPlanSegments,
  };
}
