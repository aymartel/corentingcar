import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../utils/validation.js';
import {
  createUsageChangeController,
  listUsageChangesController,
  listPendingUsageChangesController,
  approveUsageChangeController,
  rejectUsageChangeController,
  cancelUsageChangeController,
  createUsageChangeSchema,
  listUsageChangesQuerySchema,
} from '../controllers/usage-changes.controller.js';

/** Montado bajo `/api/usage/changes` (con requireAuth aplicado en el router principal). */
export const usageChangesRouter = Router();

usageChangesRouter.get('/pending', listPendingUsageChangesController);
usageChangesRouter.get('/', validate(listUsageChangesQuerySchema, 'query'), listUsageChangesController);
usageChangesRouter.post('/', validate(createUsageChangeSchema), createUsageChangeController);
usageChangesRouter.patch('/:id/approve', validate(idParamSchema, 'params'), approveUsageChangeController);
usageChangesRouter.patch('/:id/reject', validate(idParamSchema, 'params'), rejectUsageChangeController);
usageChangesRouter.patch('/:id/cancel', validate(idParamSchema, 'params'), cancelUsageChangeController);
