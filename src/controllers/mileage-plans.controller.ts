import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { monthOfIso, todayInTimezone } from '../utils/date.js';
import { getPlanBaseline, getRulesRow } from '../services/rules.service.js';
import {
  cancelScheduledPlan,
  getPlanForMonth,
  getScheduledPlan,
  listPlanHistory,
  listPlanOptions,
  scheduleMileagePlan,
  toMileagePlanDto,
} from '../services/mileage-plans.service.js';
import type { MileagePlansViewDto } from '../models/mileage-plan.js';

/**
 * Escalón de kilometraje a contratar. Ambos valores son del CUERPO, así que `z.number()` (nunca
 * `z.coerce`, que aceptaría booleanos y strings) y `.finite()` en el importe (en zod 3,
 * `positive()` no rechaza `Infinity`, y un Infinity persistido envenenaría todos los cálculos).
 *
 * El mes de efecto NO se acepta del cliente: lo calcula el servidor (día 1 del mes siguiente),
 * de modo que no existe forma de programar un cambio retroactivo.
 */
export const scheduleMileagePlanSchema = z.object({
  annualKmTotal: z.number().int().positive().max(200_000),
  monthlyFeeEur: z.number().finite().nonnegative().max(10_000),
});
type ScheduleMileagePlanBody = z.infer<typeof scheduleMileagePlanSchema>;

function requireUserId(req: Request): number {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  return req.authUser.id;
}

/** Vista completa de planes: vigente, programado, historial y catálogo de escalones. */
function buildView(): MileagePlansViewDto {
  const rulesRow = getRulesRow();
  const baseline = getPlanBaseline(rulesRow);
  const feeSplitPct = rulesRow.fee_split_pct;
  const currentMonth = monthOfIso(todayInTimezone(rulesRow.timezone));

  const current = getPlanForMonth(currentMonth, baseline);
  const scheduled = getScheduledPlan(currentMonth);

  return {
    current: toMileagePlanDto(current, feeSplitPct),
    scheduled: scheduled ? toMileagePlanDto(scheduled, feeSplitPct) : null,
    history: listPlanHistory(baseline, feeSplitPct),
    options: listPlanOptions(current, scheduled, feeSplitPct),
  };
}

/** GET /api/mileage/plans — plan vigente, cambio programado, historial y opciones. */
export const getMileagePlansController: RequestHandler = (_req, res) => {
  res.json(ok(buildView()));
};

/** POST /api/mileage/plans — programa un cambio para el día 1 del mes siguiente. */
export const scheduleMileagePlanController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const body = req.body as ScheduleMileagePlanBody;
  const rulesRow = getRulesRow();
  scheduleMileagePlan(body, userId, todayInTimezone(rulesRow.timezone));
  res.status(201).json(ok(buildView()));
};

/** DELETE /api/mileage/plans/scheduled — cancela el cambio aún no vigente. */
export const cancelMileagePlanController: RequestHandler = (_req, res) => {
  const rulesRow = getRulesRow();
  cancelScheduledPlan(todayInTimezone(rulesRow.timezone));
  res.json(ok(buildView()));
};
