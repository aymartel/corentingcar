import type { RequestHandler } from 'express';
import { ok } from '../utils/api-response.js';
import { listUsers } from '../services/users.service.js';

/** GET /api/users — perfiles disponibles para la pantalla de selección (sin `pin_hash`). */
export const usersController: RequestHandler = (_req, res) => {
  res.json(ok(listUsers()));
};
