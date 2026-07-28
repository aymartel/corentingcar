import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { monthOfIso, nextMonth } from '../utils/date.js';
import { getUsersById } from './users.service.js';
import {
  monthlyPerPersonFromAnnual,
  roundTo,
  type MonthlyAllowanceLookup,
} from './mileage.core.js';
import {
  MILEAGE_PLAN_OPTIONS,
  type MileagePlanDto,
  type MileagePlanOptionDto,
  type MileagePlanRow,
  type ResolvedPlan,
} from '../models/mileage-plan.js';

/**
 * Planes de kilometraje con fecha de efecto. Un cambio programado hoy rige DESDE el día 1 del
 * mes siguiente, de modo que los meses ya transcurridos conservan siempre el cupo y la cuota
 * que estuvieron vigentes entonces.
 *
 * Este módulo NO importa `rules.service.ts` (sería un ciclo: es `rules.service` quien lo usa a
 * él). La línea base y el "hoy" se reciben siempre por parámetro.
 */

/** Línea base del plan: las columnas de `rules`, propiedad del código (ver `reconcileBaselinePlan`). */
export interface PlanBaseline {
  annualKmTotal: number;
  monthlyFeeEur: number;
}

/** Redondeo monetario a 2 decimales. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rowToResolved(row: MileagePlanRow): ResolvedPlan {
  return {
    id: row.id,
    effectiveMonth: row.effective_month,
    annualKmTotal: row.annual_km_total,
    monthlyFeeEur: row.monthly_fee_eur,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function baselineToResolved(baseline: PlanBaseline): ResolvedPlan {
  return {
    id: null,
    effectiveMonth: null,
    annualKmTotal: baseline.annualKmTotal,
    monthlyFeeEur: baseline.monthlyFeeEur,
    createdByUserId: null,
    createdAt: null,
  };
}

/** Todas las filas de cambios, de la más antigua a la más reciente. */
export function listPlanRows(database: typeof db = db): MileagePlanRow[] {
  return database
    .prepare('SELECT * FROM mileage_plans ORDER BY effective_month')
    .all() as MileagePlanRow[];
}

/** Plan vigente en un mes `YYYY-MM`: último cambio con `effective_month <= month`, o la base. */
export function getPlanForMonth(month: string, baseline: PlanBaseline): ResolvedPlan {
  const row = db
    .prepare(
      `SELECT * FROM mileage_plans
       WHERE effective_month <= ?
       ORDER BY effective_month DESC
       LIMIT 1`,
    )
    .get(month) as MileagePlanRow | undefined;
  return row ? rowToResolved(row) : baselineToResolved(baseline);
}

/** Cambio programado para un mes FUTURO, si lo hay (solo puede haber uno). */
export function getScheduledPlan(currentMonth: string): ResolvedPlan | null {
  const row = db
    .prepare(
      `SELECT * FROM mileage_plans
       WHERE effective_month > ?
       ORDER BY effective_month
       LIMIT 1`,
    )
    .get(currentMonth) as MileagePlanRow | undefined;
  return row ? rowToResolved(row) : null;
}

/**
 * Resolutor `(año, mes) → cupo mensual por persona`, con TODAS las filas cargadas de una vez y
 * resueltas en memoria. Es imprescindible que sea así: `getMileage()` recorre N meses y cada uno
 * ya hace 2 consultas; buscar el plan dentro del bucle multiplicaría las consultas por request.
 */
export function buildMonthlyAllowanceLookup(baseline: PlanBaseline): MonthlyAllowanceLookup {
  const rows = listPlanRows();
  return (year: number, month1: number): number => {
    const month = `${year}-${String(month1).padStart(2, '0')}`;
    let annualKmTotal = baseline.annualKmTotal;
    for (const row of rows) {
      if (row.effective_month > month) break; // ordenadas ascendentemente
      annualKmTotal = row.annual_km_total;
    }
    return monthlyPerPersonFromAnnual(annualKmTotal);
  };
}

/** Igual que [buildMonthlyAllowanceLookup] pero devolviendo el kilometraje ANUAL del mes. */
export function buildAnnualKmLookup(baseline: PlanBaseline): MonthlyAllowanceLookup {
  const lookup = buildMonthlyAllowanceLookup(baseline);
  return (year, month1) => lookup(year, month1) * 24;
}

/** DTO de un plan, con todo lo derivado (mensual, por persona, cuota por persona) en servidor. */
export function toMileagePlanDto(plan: ResolvedPlan, feeSplitPct: number): MileagePlanDto {
  const usersById = plan.createdByUserId === null ? null : getUsersById();
  return {
    id: plan.id,
    effectiveMonth: plan.effectiveMonth,
    annualKmTotal: plan.annualKmTotal,
    annualKmPerPerson: Math.round(plan.annualKmTotal / 2),
    monthlyKmTotal: Math.round(plan.annualKmTotal / 12),
    monthlyKmPerPerson: roundTo(monthlyPerPersonFromAnnual(plan.annualKmTotal), 2),
    monthlyFeeEur: round2(plan.monthlyFeeEur),
    feePerPerson: round2((plan.monthlyFeeEur * feeSplitPct) / 100),
    createdBy:
      plan.createdByUserId === null ? null : (usersById?.get(plan.createdByUserId) ?? null),
    createdAt: plan.createdAt,
  };
}

/** Línea base + todos los cambios, del más reciente al más antiguo (para el historial). */
export function listPlanHistory(baseline: PlanBaseline, feeSplitPct: number): MileagePlanDto[] {
  const rows = listPlanRows();
  const plans = [baselineToResolved(baseline), ...rows.map(rowToResolved)];
  return plans.reverse().map((plan) => toMileagePlanDto(plan, feeSplitPct));
}

/** Catálogo de escalones con su impacto respecto al plan vigente y al programado. */
export function listPlanOptions(
  current: ResolvedPlan,
  scheduled: ResolvedPlan | null,
  feeSplitPct: number,
): MileagePlanOptionDto[] {
  const cheapest = Math.min(...MILEAGE_PLAN_OPTIONS.map((o) => o.monthlyFeeEur));
  return MILEAGE_PLAN_OPTIONS.map((option) => ({
    annualKmTotal: option.annualKmTotal,
    annualKmPerPerson: Math.round(option.annualKmTotal / 2),
    monthlyKmTotal: Math.round(option.annualKmTotal / 12),
    monthlyKmPerPerson: roundTo(monthlyPerPersonFromAnnual(option.annualKmTotal), 2),
    monthlyFeeEur: round2(option.monthlyFeeEur),
    feePerPerson: round2((option.monthlyFeeEur * feeSplitPct) / 100),
    extraFeeEur: round2(option.monthlyFeeEur - cheapest),
    feeDeltaEur: round2(option.monthlyFeeEur - current.monthlyFeeEur),
    // Se casa SOLO por km: si el renting sube la tarifa base, el escalón vigente debe
    // seguir marcándose aunque su cuota ya no coincida con la del catálogo.
    isCurrent: option.annualKmTotal === current.annualKmTotal,
    isScheduled: scheduled !== null && option.annualKmTotal === scheduled.annualKmTotal,
  }));
}

/**
 * Programa un cambio de plan para el día 1 del MES SIGUIENTE. El mes lo calcula el servidor a
 * partir de `todayIso` (que viene de `todayInTimezone(rules.timezone)`): el cliente nunca lo
 * envía, así no existe forma de programar un cambio retroactivo.
 *
 * Reemplaza cualquier cambio ya programado (solo puede haber uno pendiente) y NUNCA toca filas
 * de meses ya vigentes o pasados. Se inserta fila siempre, también al volver al plan de partida:
 * así la bajada queda registrada con su autor.
 */
export function scheduleMileagePlan(
  input: { annualKmTotal: number; monthlyFeeEur: number },
  userId: number,
  todayIso: string,
): ResolvedPlan {
  const currentMonth = monthOfIso(todayIso);
  const effectiveMonth = nextMonth(currentMonth);

  const run = db.transaction(() => {
    // Un único cambio programado a la vez; el histórico (<= mes en curso) queda intacto.
    db.prepare('DELETE FROM mileage_plans WHERE effective_month > @currentMonth').run({
      currentMonth,
    });
    db.prepare(
      `INSERT INTO mileage_plans (effective_month, annual_km_total, monthly_fee_eur, created_by_user_id)
       VALUES (@effectiveMonth, @annualKmTotal, @monthlyFeeEur, @userId)
       ON CONFLICT(effective_month) DO UPDATE SET
         annual_km_total = excluded.annual_km_total,
         monthly_fee_eur = excluded.monthly_fee_eur,
         created_by_user_id = excluded.created_by_user_id,
         created_at = datetime('now')`,
    ).run({
      effectiveMonth,
      annualKmTotal: input.annualKmTotal,
      monthlyFeeEur: round2(input.monthlyFeeEur),
      userId,
    });
  });
  run();

  const row = db
    .prepare('SELECT * FROM mileage_plans WHERE effective_month = ?')
    .get(effectiveMonth) as MileagePlanRow | undefined;
  if (!row) {
    throw new AppError('SERVER_ERROR', 'No se pudo guardar el cambio de kilometraje.', 500);
  }
  return rowToResolved(row);
}

/** Cancela el cambio programado. Solo alcanza meses futuros: el pasado es inmutable. */
export function cancelScheduledPlan(todayIso: string): void {
  const currentMonth = monthOfIso(todayIso);
  const result = db
    .prepare('DELETE FROM mileage_plans WHERE effective_month > @currentMonth')
    .run({ currentMonth });
  if (result.changes === 0) {
    throw new AppError(
      'NO_SCHEDULED_PLAN',
      'No hay ningún cambio de kilometraje programado. Si ya entró en vigor, programa otro para el mes que viene.',
      404,
    );
  }
}
