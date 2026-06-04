import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

/** Captura cualquier ruta no registrada y la convierte en un AppError 404. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
};
