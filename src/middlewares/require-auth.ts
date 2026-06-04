import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';
import { getUserByToken } from '../services/auth.service.js';

/**
 * Protege rutas privadas. Lee `Authorization: Bearer <token>`, valida la sesión y adjunta
 * `req.authUser` / `req.authToken`. Responde 401 si falta o es inválido/caducado.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(new AppError('UNAUTHENTICATED', 'Falta el token de sesión.', 401));
    return;
  }

  const user = getUserByToken(token);
  if (!user) {
    next(new AppError('UNAUTHENTICATED', 'Sesión inválida o caducada.', 401));
    return;
  }

  req.authUser = user;
  req.authToken = token;
  next();
};
