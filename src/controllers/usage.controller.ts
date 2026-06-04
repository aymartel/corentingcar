import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import { createUsage, listUsage } from '../services/usage.service.js';

/** Cuerpo de POST /api/usage. `totalKm` lo calcula el servidor. Distancias en km. */
export const createUsageSchema = z
  .object({
    date: isoDateSchema,
    startKm: z.number().int().min(0),
    endKm: z.number().int().min(0),
    type: z.enum(['individual', 'shared']),
  })
  .refine((d) => d.endKm >= d.startKm, {
    message: 'endKm debe ser mayor o igual que startKm.',
    path: ['endKm'],
  });

type CreateUsageBody = z.infer<typeof createUsageSchema>;

/** Filtros de GET /api/usage. */
export const listUsageQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

type ListUsageQuery = z.infer<typeof listUsageQuerySchema>;

/** POST /api/usage — registra un uso asociado al usuario autenticado. */
export const createUsageController: RequestHandler = (req, res) => {
  if (!req.authUser) {
    throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  }
  const body = req.body as CreateUsageBody;
  res.status(201).json(ok(createUsage(req.authUser.id, body)));
};

/** GET /api/usage — lista registros de uso (filtros por usuario/rango de fechas). */
export const listUsageController: RequestHandler = (req, res) => {
  const query = req.query as ListUsageQuery;
  res.json(ok(listUsage({ userId: query.userId, from: query.from, to: query.to })));
};
