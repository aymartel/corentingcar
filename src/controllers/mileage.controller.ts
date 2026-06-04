import type { RequestHandler } from 'express';
import { ok } from '../utils/api-response.js';
import { getMileage } from '../services/mileage.service.js';

/** GET /api/mileage — resumen de km por persona (usados/restantes/exceso) + compartidos. */
export const mileageController: RequestHandler = (_req, res) => {
  res.json(ok(getMileage()));
};
