import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { isoDateSchema } from '../utils/validation.js';
import {
  createHandoverController,
  deleteHandoverController,
  createHandoverSchema,
} from '../controllers/handover.controller.js';

/** Montado bajo `/api/handovers` (con requireAuth aplicado en el router principal). */
export const handoverRouter = Router();

handoverRouter.post('/', validate(createHandoverSchema), createHandoverController);
handoverRouter.delete(
  '/:date',
  validate(z.object({ date: isoDateSchema }), 'params'),
  deleteHandoverController,
);
