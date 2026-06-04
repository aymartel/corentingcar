import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';
import { fail, type ApiFailure } from '../utils/api-response.js';
import { env } from '../config/env.js';

export interface SerializedError {
  status: number;
  body: ApiFailure;
  /** true si es un error no controlado que conviene loguear internamente. */
  logInternal: boolean;
}

/**
 * Traduce cualquier error al sobre común. PURA y testeable: en producción NO incluye
 * `details` (ni stack); fuera de producción adjunta `details` de los AppError para depurar.
 * Los errores no controlados SIEMPRE devuelven un mensaje genérico (nunca filtran internos).
 */
export function errorToResponse(err: unknown, isProduction: boolean): SerializedError {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: fail(err.code, err.message, isProduction ? undefined : err.details),
      logInternal: false,
    };
  }
  return {
    status: 500,
    body: fail('INTERNAL_ERROR', 'Se ha producido un error interno.'),
    logInternal: true,
  };
}

/** Middleware de errores global (última capa). */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body, logInternal } = errorToResponse(err, env.isProduction);
  if (logInternal && !env.isProduction) {
    console.error(err);
  }
  res.status(status).json(body);
};
