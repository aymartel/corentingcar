import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import {
  createUsageController,
  listUsageController,
  createUsageSchema,
  listUsageQuerySchema,
} from '../controllers/usage.controller.js';

/** Montado bajo `/api/usage` (con requireAuth aplicado en el router principal). */
export const usageRouter = Router();

usageRouter.post('/', validate(createUsageSchema), createUsageController);
usageRouter.get('/', validate(listUsageQuerySchema, 'query'), listUsageController);
