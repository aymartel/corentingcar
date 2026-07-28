import type { UserDto } from './user.js';

/**
 * Plan de kilometraje contratado. Los escalones son ANUALES: lo mensual se deriva dividiendo
 * entre 12, y lo de cada persona dividiendo además entre 2 (25.000 → 2.083 km/mes → 1.041,67
 * por persona). Un cambio entra en vigor el día 1 del mes siguiente al que se programa.
 */

/** Fila `mileage_plans` tal cual en la base de datos (snake_case). */
export interface MileagePlanRow {
  id: number;
  effective_month: string;
  annual_km_total: number;
  monthly_fee_eur: number;
  created_by_user_id: number | null;
  created_at: string;
}

/**
 * Plan resuelto para un mes: la fila vigente o la línea base de `rules`. `id` es `null` y
 * `effectiveMonth` es `null` cuando se trata de la línea base (nunca se programó ningún cambio).
 */
export interface ResolvedPlan {
  id: number | null;
  effectiveMonth: string | null;
  annualKmTotal: number;
  monthlyFeeEur: number;
  createdByUserId: number | null;
  createdAt: string | null;
}

/** DTO de un plan para la API, con todo lo derivado calculado en el servidor. */
export interface MileagePlanDto {
  /** `null` en la línea base (el plan con el que arrancó el acuerdo). */
  id: number | null;
  /** Mes `YYYY-MM` desde el que rige; `null` en la línea base ("desde el inicio"). */
  effectiveMonth: string | null;
  annualKmTotal: number;
  annualKmPerPerson: number;
  /** Cupo mensual de los dos = anual / 12 (25.000 → 2.083). Solo presentación. */
  monthlyKmTotal: number;
  /** Cupo mensual por persona = anual / 24, con 2 decimales (25.000 → 1041.67). */
  monthlyKmPerPerson: number;
  monthlyFeeEur: number;
  feePerPerson: number;
  createdBy: UserDto | null;
  createdAt: string | null;
}

/** Una opción del catálogo, con su impacto ya calculado respecto al plan vigente. */
export interface MileagePlanOptionDto {
  annualKmTotal: number;
  annualKmPerPerson: number;
  monthlyKmTotal: number;
  monthlyKmPerPerson: number;
  monthlyFeeEur: number;
  feePerPerson: number;
  /** Sobrecoste frente al escalón más barato del catálogo (0 / 30 / 70). */
  extraFeeEur: number;
  /** Diferencia de cuota frente al plan VIGENTE (puede ser negativa al bajar). */
  feeDeltaEur: number;
  isCurrent: boolean;
  isScheduled: boolean;
}

/** Respuesta de `GET /api/mileage/plans`. */
export interface MileagePlansViewDto {
  current: MileagePlanDto;
  /** Cambio programado para un mes futuro, si lo hay. */
  scheduled: MileagePlanDto | null;
  /** Línea base + todos los cambios, del más reciente al más antiguo. */
  history: MileagePlanDto[];
  options: MileagePlanOptionDto[];
}

/**
 * Catálogo de escalones del renting. Vive en el backend (y no en la app) para que cambiar las
 * tarifas sea un redespliegue del servidor y no reinstalar la app en los dos móviles.
 */
export const MILEAGE_PLAN_OPTIONS: readonly { annualKmTotal: number; monthlyFeeEur: number }[] = [
  { annualKmTotal: 15000, monthlyFeeEur: 355 },
  { annualKmTotal: 20000, monthlyFeeEur: 385 },
  { annualKmTotal: 25000, monthlyFeeEur: 425 },
];
