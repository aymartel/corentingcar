import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/app-error.js';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Middleware de validación con zod. Valida la parte indicada de la request (`body` por
 * defecto) y, si falla, lanza un AppError 400 con `code: 'VALIDATION_ERROR'`. Si pasa,
 * reemplaza la parte por los datos ya parseados/coaccionados.
 *
 * Uso: `router.post('/usage', validate(usageSchema), controller)`
 */
export function validate(schema: z.ZodTypeAny, part: RequestPart = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400, result.error.flatten()));
      return;
    }
    // Reasignar los datos validados (zod puede coaccionar/normalizar).
    Reflect.set(req, part, result.data);
    next();
  };
}
