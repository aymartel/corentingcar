import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isAdminPassword, resetAllData } from '../services/admin.service.js';

/** Cuerpo de POST /api/admin/reset. */
export const resetSchema = z.object({
  /** Odómetro inicial (km) con el que se recibe el coche. */
  initialKm: z.number().int().min(0),
  /** Contraseña de administrador (Pass4admin). */
  password: z.string().min(1),
});

type ResetBody = z.infer<typeof resetSchema>;

/**
 * POST /api/admin/reset — borra todos los datos y fija el odómetro inicial.
 * Requiere token de sesión (requireAuth) + contraseña de administrador.
 */
export const resetController: RequestHandler = (req, res) => {
  if (!req.authUser) {
    throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  }
  const body = req.body as ResetBody;
  if (!isAdminPassword(body.password)) {
    throw new AppError('FORBIDDEN', 'Contraseña de administrador incorrecta.', 403);
  }

  const result = resetAllData(req.authUser.id, body.initialKm);
  res.json(ok({ message: 'Todos los datos han sido reseteados.', ...result }));
};
