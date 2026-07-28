import type { MileagePlanDto } from './mileage-plan.js';

/** Fila `rules` tal cual en la base de datos (snake_case). */
export interface RulesRow {
  id: number;
  monthly_fee_eur: number;
  fee_split_pct: number;
  annual_km_total: number;
  annual_km_per_person: number;
  km_window: string;
  shared_km_rounding: number;
  anchor_date: string;
  anchor_user_id: number;
  first_wash_user_id: number;
  timezone: string;
  updated_at: string;
}

/** DTO de reglas para la API (camelCase), con el reparto por persona derivado. */
export interface RulesDto {
  /** Cuota del plan de kilometraje VIGENTE hoy (no necesariamente la de `rules`). */
  monthlyFeeEur: number;
  feeSplitPct: number;
  /** Derivado en servidor: monthlyFeeEur * fee_split_pct / 100 (p.ej. 177.5). */
  feePerPerson: number;
  /** NOMINAL del plan contratado vigente (15.000 / 20.000 / 25.000 km al año). */
  annualKmTotal: number;
  annualKmPerPerson: number;
  kmWindow: string;
  sharedKmRounding: number;
  anchorDate: string;
  anchorUserId: number;
  firstWashUserId: number;
  timezone: string;
  updatedAt: string;
  /** Plan de kilometraje vigente hoy, con sus cifras mensuales y por persona ya derivadas. */
  kmPlan: MileagePlanDto;
  /** Cambio de plan programado para un mes futuro, si lo hay. */
  scheduledKmPlan: MileagePlanDto | null;
}
