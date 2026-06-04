import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import {
  createRequestController,
  listRequestsController,
  listPendingController,
  acceptRequestController,
  rejectRequestController,
  cancelRequestController,
  createRequestSchema,
  listRequestsQuerySchema,
  idParamSchema,
} from '../controllers/requests.controller.js';

/** Montado bajo `/api/requests` (con requireAuth aplicado en el router principal). */
export const requestsRouter = Router();

requestsRouter.get('/pending', listPendingController);
requestsRouter.get('/', validate(listRequestsQuerySchema, 'query'), listRequestsController);
requestsRouter.post('/', validate(createRequestSchema), createRequestController);
requestsRouter.patch('/:id/accept', validate(idParamSchema, 'params'), acceptRequestController);
requestsRouter.patch('/:id/reject', validate(idParamSchema, 'params'), rejectRequestController);
requestsRouter.patch('/:id/cancel', validate(idParamSchema, 'params'), cancelRequestController);
