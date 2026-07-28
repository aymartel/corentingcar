import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../utils/validation.js';
import {
  createIncidentController,
  createIncidentSchema,
  deleteIncidentController,
  listIncidentsController,
  listIncidentsQuerySchema,
  reopenIncidentController,
  resolveIncidentController,
  resolveIncidentSchema,
  updateIncidentController,
  updateIncidentSchema,
} from '../controllers/incidents.controller.js';

/** Montado bajo `/api/incidents` (con requireAuth aplicado en el router principal). */
export const incidentsRouter = Router();

incidentsRouter.get('/', validate(listIncidentsQuerySchema, 'query'), listIncidentsController);
incidentsRouter.post('/', validate(createIncidentSchema), createIncidentController);
incidentsRouter.patch(
  '/:id/resolve',
  validate(idParamSchema, 'params'),
  validate(resolveIncidentSchema),
  resolveIncidentController,
);
incidentsRouter.patch('/:id/reopen', validate(idParamSchema, 'params'), reopenIncidentController);
incidentsRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateIncidentSchema),
  updateIncidentController,
);
incidentsRouter.delete('/:id', validate(idParamSchema, 'params'), deleteIncidentController);
