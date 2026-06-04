import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { login, logout } from '../services/auth.service.js';
import { recordLoginFailure, recordLoginSuccess } from '../middlewares/rate-limit.js';

/** Esquema de validación del login (usado con `validate(...)`). */
export const loginSchema = z.object({
  profile: z.enum(['andy', 'amigo']),
  pin: z.string().min(1),
});

type LoginBody = z.infer<typeof loginSchema>;

/** POST /api/auth/login — valida perfil + PIN y devuelve `{ token, user }`. */
export const loginController: RequestHandler = (req, res, next) => {
  const { profile, pin } = req.body as LoginBody;
  try {
    const result = login(profile, pin);
    recordLoginSuccess(req); // limpia el contador de intentos fallidos
    res.json(ok(result));
  } catch (err) {
    if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
      recordLoginFailure(req);
    }
    next(err);
  }
};

/** POST /api/auth/logout — invalida la sesión actual (requiere auth). */
export const logoutController: RequestHandler = (req, res) => {
  if (req.authToken) {
    logout(req.authToken);
  }
  res.json(ok({ loggedOut: true }));
};

/** GET /api/auth/me — usuario autenticado (requiere auth). */
export const meController: RequestHandler = (req, res) => {
  res.json(ok(req.authUser));
};
