import { Router } from 'express';
import { z } from 'zod';
import { healthController } from '../controllers/health.controller.js';
import { rulesController } from '../controllers/rules.controller.js';
import { usersController } from '../controllers/users.controller.js';
import { calendarController } from '../controllers/priority.controller.js';
import { mileageController } from '../controllers/mileage.controller.js';
import {
  createFuelController,
  createWashController,
  getExpensesController,
  createFuelSchema,
  createWashSchema,
} from '../controllers/expenses.controller.js';
import { authRouter } from './auth.routes.js';
import { priorityRouter } from './priority.routes.js';
import { handoverRouter } from './handover.routes.js';
import { usageRouter } from './usage.routes.js';
import { requestsRouter } from './requests.routes.js';
import { requireAuth } from '../middlewares/require-auth.js';
import { validate } from '../middlewares/validate.js';
import { monthSchema } from '../utils/validation.js';

/** Router principal de la API. Se monta bajo el prefijo `/api` en `app.ts`. */
export const apiRouter = Router();

// Públicas
apiRouter.get('/health', healthController);
apiRouter.get('/rules', rulesController);
apiRouter.get('/users', usersController);
apiRouter.use('/auth', authRouter);

// Privadas (requieren sesión)
apiRouter.use('/priority', requireAuth, priorityRouter);
apiRouter.get('/calendar', requireAuth, validate(z.object({ month: monthSchema }), 'query'), calendarController);
apiRouter.use('/handovers', requireAuth, handoverRouter);
apiRouter.use('/usage', requireAuth, usageRouter);
apiRouter.get('/mileage', requireAuth, mileageController);
apiRouter.post('/fuel', requireAuth, validate(createFuelSchema), createFuelController);
apiRouter.post('/washes', requireAuth, validate(createWashSchema), createWashController);
apiRouter.get('/expenses', requireAuth, getExpensesController);
apiRouter.use('/requests', requireAuth, requestsRouter);
