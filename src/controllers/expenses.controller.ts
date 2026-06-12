import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import { createFuel, createOtherExpense, createWash, getExpenses } from '../services/expenses.service.js';
import { computeFuelSplit } from '../services/fuel-split.service.js';

/**
 * Cuerpo de POST /api/fuel. La gasolina siempre es compartida: el importe se reparte por los km
 * de cada persona desde el último repostaje, según el odómetro del cuadro (`odometerKm`). No se
 * envía `type`. Importe en € (> 0, finito); `odometerKm` entero >= 0.
 */
export const createFuelSchema = z.object({
  date: isoDateSchema,
  amountEur: z.number().finite().positive(),
  odometerKm: z.number().int().nonnegative(),
});

type CreateFuelBody = z.infer<typeof createFuelSchema>;

/** Query de GET /api/fuel/preview. Importe en € (> 0) y odómetro (entero >= 0). En query: `coerce`. */
export const fuelPreviewSchema = z.object({
  amountEur: z.coerce.number().finite().positive(),
  odometerKm: z.coerce.number().int().nonnegative(),
});

type FuelPreviewQuery = z.infer<typeof fuelPreviewSchema>;

/** Cuerpo de POST /api/washes. Coste opcional (€, >= 0, finito). */
export const createWashSchema = z.object({
  date: isoDateSchema,
  costEur: z.number().finite().nonnegative().optional(),
});

type CreateWashBody = z.infer<typeof createWashSchema>;

/** Cuerpo de POST /api/other-expenses. Importe en € (> 0, finito) + descripción obligatoria. */
export const createOtherExpenseSchema = z.object({
  date: isoDateSchema,
  amountEur: z.number().finite().positive(),
  type: z.enum(['individual', 'shared']),
  description: z.string().trim().min(1).max(120),
});

type CreateOtherExpenseBody = z.infer<typeof createOtherExpenseSchema>;

/** POST /api/fuel — registra un repostaje del usuario autenticado. */
export const createFuelController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const body = req.body as CreateFuelBody;
  res.status(201).json(ok(createFuel(req.authUser.id, body)));
};

/** GET /api/fuel/preview — calcula (sin persistir) el reparto por km para el usuario autenticado. */
export const fuelPreviewController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const query = req.query as unknown as FuelPreviewQuery;
  res.json(ok(computeFuelSplit(req.authUser.id, query.odometerKm, query.amountEur)));
};

/** POST /api/washes — registra un lavado del usuario autenticado. */
export const createWashController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const body = req.body as CreateWashBody;
  res.status(201).json(ok(createWash(req.authUser.id, body)));
};

/** POST /api/other-expenses — registra un "otro gasto" del usuario autenticado. */
export const createOtherExpenseController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const body = req.body as CreateOtherExpenseBody;
  res.status(201).json(ok(createOtherExpense(req.authUser.id, body)));
};

/** GET /api/expenses — resumen de gasolina (balance) + lavado (último/próximo). */
export const getExpensesController: RequestHandler = (_req, res) => {
  res.json(ok(getExpenses()));
};
