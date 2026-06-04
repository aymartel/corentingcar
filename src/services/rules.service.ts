import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import type { RulesRow, RulesDto } from '../models/rules.js';

/** Redondeo monetario a 2 decimales. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lee la configuración fija (singleton `rules`) y devuelve el DTO con `feePerPerson`
 * derivado en el servidor. Datos de SOLO LECTURA (no se editan desde la API).
 */
export function getRules(): RulesDto {
  const row = db.prepare('SELECT * FROM rules WHERE id = 1').get() as RulesRow | undefined;
  if (!row) {
    throw new AppError(
      'NOT_FOUND',
      'No hay configuración (rules) sembrada. Ejecuta el seed (pnpm db:seed).',
      404,
    );
  }

  return {
    monthlyFeeEur: row.monthly_fee_eur,
    feeSplitPct: row.fee_split_pct,
    feePerPerson: round2((row.monthly_fee_eur * row.fee_split_pct) / 100),
    annualKmTotal: row.annual_km_total,
    annualKmPerPerson: row.annual_km_per_person,
    kmWindow: row.km_window,
    sharedKmRounding: row.shared_km_rounding,
    anchorDate: row.anchor_date,
    anchorUserId: row.anchor_user_id,
    firstWashUserId: row.first_wash_user_id,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}
