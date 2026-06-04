import { z } from 'zod';
import { isValidIsoDate } from './date.js';

/** Esquema zod reutilizable para una fecha `YYYY-MM-DD` real. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: YYYY-MM-DD')
  .refine(isValidIsoDate, 'Fecha de calendario inexistente');

/** Esquema zod reutilizable para un mes `YYYY-MM`. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato de mes esperado: YYYY-MM');
