import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { isoDateSchema } from '../utils/validation.js';
import { todayController, priorityController } from '../controllers/priority.controller.js';

/** Montado bajo `/api/priority` (con requireAuth aplicado en el router principal). */
export const priorityRouter = Router();

priorityRouter.get('/today', todayController);
priorityRouter.get('/', validate(z.object({ date: isoDateSchema }), 'query'), priorityController);
