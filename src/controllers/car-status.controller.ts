import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { getCarStatus, setCarStatus } from '../services/car-status.service.js';

/** Cuerpo de POST /api/car-status. */
export const setCarStatusSchema = z
  .object({
    status: z.enum(['free', 'taken']),
    // Parqueo: en casa de cada persona (user1/user2) u "otro" (con descripción).
    parking: z.enum(['user1', 'user2', 'other']).optional(),
    note: z.string().trim().max(200).optional(),
  })
  // Si el parqueo es "otro", la descripción (note) es obligatoria.
  .refine((b) => b.parking !== 'other' || !!b.note, {
    message: 'Indica una descripcion cuando el parqueo es "otro".',
    path: ['note'],
  });

type SetCarStatusBody = z.infer<typeof setCarStatusSchema>;

/** GET /api/car-status — estado actual (libre/ocupado, quién, desde cuándo, nota). */
export const getCarStatusController: RequestHandler = (_req, res) => {
  res.json(ok(getCarStatus()));
};

/** POST /api/car-status — el usuario autenticado fija el estado. */
export const setCarStatusController: RequestHandler = (req, res) => {
  if (!req.authUser) {
    throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  }
  const body = req.body as SetCarStatusBody;
  res.json(ok(setCarStatus(req.authUser.id, body)));
};
