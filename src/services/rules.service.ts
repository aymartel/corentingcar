import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { monthOfIso, todayInTimezone } from '../utils/date.js';
import type { RulesRow, RulesDto } from '../models/rules.js';
import {
  getPlanForMonth,
  getScheduledPlan,
  toMileagePlanDto,
  type PlanBaseline,
} from './mileage-plans.service.js';

/** Redondeo monetario a 2 decimales. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fila `rules` cruda. Lanza 404 si no está sembrada. */
export function getRulesRow(): RulesRow {
  const row = db.prepare('SELECT * FROM rules WHERE id = 1').get() as RulesRow | undefined;
  if (!row) {
    throw new AppError(
      'NOT_FOUND',
      'No hay configuración (rules) sembrada. Ejecuta el seed (pnpm db:seed).',
      404,
    );
  }
  return row;
}

/** Línea base del plan de kilometraje (columnas de `rules`, propiedad del código). */
export function getPlanBaseline(row: RulesRow): PlanBaseline {
  return { annualKmTotal: row.annual_km_total, monthlyFeeEur: row.monthly_fee_eur };
}

/**
 * Lee la configuración (singleton `rules`) y devuelve el DTO. El **kilometraje y la cuota** ya
 * no salen directamente de `rules`: se resuelven del plan vigente hoy (`mileage_plans`, con
 * `rules` como línea base), de modo que un cambio programado se refleja solo a partir del día 1
 * del mes en que entra en vigor. `feePerPerson` se deriva de la MISMA cuota resuelta, para que
 * la cifra total y la de por persona nunca se desincronicen.
 *
 * `annualKmTotal` aquí es el **nominal del plan contratado** (25.000 km/año). El cupo efectivo
 * del año natural en curso, que puede ser mixto si hubo un cambio, lo devuelve `GET /api/mileage`.
 */
export function getRules(): RulesDto {
  const row = getRulesRow();
  const baseline = getPlanBaseline(row);
  const today = todayInTimezone(row.timezone);
  const currentMonth = monthOfIso(today);

  const currentPlan = getPlanForMonth(currentMonth, baseline);
  const scheduledPlan = getScheduledPlan(currentMonth);

  return {
    monthlyFeeEur: round2(currentPlan.monthlyFeeEur),
    feeSplitPct: row.fee_split_pct,
    feePerPerson: round2((currentPlan.monthlyFeeEur * row.fee_split_pct) / 100),
    annualKmTotal: currentPlan.annualKmTotal,
    annualKmPerPerson: Math.round(currentPlan.annualKmTotal / 2),
    kmWindow: row.km_window,
    sharedKmRounding: row.shared_km_rounding,
    anchorDate: row.anchor_date,
    anchorUserId: row.anchor_user_id,
    firstWashUserId: row.first_wash_user_id,
    timezone: row.timezone,
    updatedAt: row.updated_at,
    kmPlan: toMileagePlanDto(currentPlan, row.fee_split_pct),
    scheduledKmPlan: scheduledPlan ? toMileagePlanDto(scheduledPlan, row.fee_split_pct) : null,
  };
}
