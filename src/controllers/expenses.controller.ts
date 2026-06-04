import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import { createFuel, createWash, getExpenses } from '../services/expenses.service.js';

/** Cuerpo de POST /api/fuel. Importe en € (> 0, finito). El servidor lo redondea a 2 decimales. */
export const createFuelSchema = z.object({
  date: isoDateSchema,
  amountEur: z.number().finite().positive(),
  type: z.enum(['individual', 'shared']),
});

type CreateFuelBody = z.infer<typeof createFuelSchema>;

/** Cuerpo de POST /api/washes. Coste opcional (€, >= 0, finito). */
export const createWashSchema = z.object({
  date: isoDateSchema,
  costEur: z.number().finite().nonnegative().optional(),
});

type CreateWashBody = z.infer<typeof createWashSchema>;

/** POST /api/fuel — registra un repostaje del usuario autenticado. */
export const createFuelController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const body = req.body as CreateFuelBody;
  res.status(201).json(ok(createFuel(req.authUser.id, body)));
};

/** POST /api/washes — registra un lavado del usuario autenticado. */
export const createWashController: RequestHandler = (req, res) => {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  const body = req.body as CreateWashBody;
  res.status(201).json(ok(createWash(req.authUser.id, body)));
};

/** GET /api/expenses — resumen de gasolina (balance) + lavado (último/próximo). */
export const getExpensesController: RequestHandler = (_req, res) => {
  res.json(ok(getExpenses()));
};
