import type { RequestHandler } from 'express';
import { ok } from '../utils/api-response.js';
import { getRules } from '../services/rules.service.js';

/** GET /api/rules — configuración fija de solo lectura (incluye feePerPerson derivado). */
export const rulesController: RequestHandler = (_req, res) => {
  res.json(ok(getRules()));
};
