import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { isoDateSchema } from '../utils/validation.js';
import { upsertHandover, deleteHandover, handoverToDto } from '../services/handover.service.js';

/** Cuerpo de creación de un handover manual (la solicitud aceptada la gestiona B7). */
export const createHandoverSchema = z.object({
  date: isoDateSchema,
  effectivePriorityUserId: z.number().int().positive(),
  origin: z.enum(['manual', 'one_off_change']).default('manual'),
});

type CreateHandoverBody = z.infer<typeof createHandoverSchema>;

/** POST /api/handovers — crea/actualiza el override (el último gana). */
export const createHandoverController: RequestHandler = (req, res) => {
  const body = req.body as CreateHandoverBody;
  const row = upsertHandover({
    date: body.date,
    effectivePriorityUserId: body.effectivePriorityUserId,
    origin: body.origin,
  });
  res.status(201).json(ok(handoverToDto(row)));
};

/** DELETE /api/handovers/:date — elimina el override (vuelve a la alternancia base). */
export const deleteHandoverController: RequestHandler = (req, res) => {
  const { date } = req.params as { date: string };
  res.json(ok({ deleted: deleteHandover(date) }));
};
