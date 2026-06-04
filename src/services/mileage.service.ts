import { db } from '../db/connection.js';
import { getRules } from './rules.service.js';
import { listUsers } from './users.service.js';
import { sharedPerPerson, personMileage, type PersonMileage } from './mileage.core.js';
import { todayInTimezone } from '../utils/date.js';
import type { UserDto } from '../models/user.js';

export interface PersonMileageDto extends PersonMileage {
  user: UserDto;
  individualKm: number;
}

export interface MileageSummary {
  kmWindow: string;
  windowStart: string;
  windowEnd: string;
  annualKmTotal: number;
  annualKmPerPerson: number;
  sharedKm: number;
  sharedKmPerPerson: number;
  perUser: PersonMileageDto[];
}

/**
 * Resumen de km del periodo. Ventana según `rules.km_window` ('natural' = año natural en
 * curso, en la zona horaria de `rules`). Límite y redondeo vienen de `rules` (no hardcodeados).
 */
export function getMileage(): MileageSummary {
  const rules = getRules();
  const year = todayInTimezone(rules.timezone).slice(0, 4);
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

  const perUser: PersonMileageDto[] = listUsers().map((user) => {
    const individualKm = individualByUser.get(user.id) ?? 0;
    return { user, individualKm, ...personMileage(individualKm, share, rules.annualKmPerPerson) };
  });

  return {
    kmWindow: rules.kmWindow,
    windowStart,
    windowEnd,
    annualKmTotal: rules.annualKmTotal,
    annualKmPerPerson: rules.annualKmPerPerson,
    sharedKm: sharedTotal,
    sharedKmPerPerson: share,
    perUser,
  };
}
