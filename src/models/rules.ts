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
  monthlyFeeEur: number;
  feeSplitPct: number;
  /** Derivado en servidor: monthly_fee_eur * fee_split_pct / 100 (p.ej. 177.5). */
  feePerPerson: number;
  annualKmTotal: number;
  annualKmPerPerson: number;
  kmWindow: string;
  sharedKmRounding: number;
  anchorDate: string;
  anchorUserId: number;
  firstWashUserId: number;
  timezone: string;
  updatedAt: string;
}
