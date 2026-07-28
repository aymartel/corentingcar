import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import {
  createIncident,
  deleteIncident,
  listIncidents,
  reopenIncident,
  resolveIncident,
  updateIncident,
} from '../services/incidents.service.js';

/**
 * Incidencias del coche. El importe es OPCIONAL (`nonnegative`, no `positive`: una incidencia
 * puede registrarse sin saber aún cuánto cuesta) y `.finite()` porque en zod 3 `nonnegative()`
 * no rechaza `Infinity`, que envenenaría todos los cálculos del saldo.
 */
const kindSchema = z.enum(['fine', 'damage', 'breakdown', 'other']);
const amountSchema = z.number().finite().nonnegative().max(1_000_000);
const userIdSchema = z.number().int().positive();

export const createIncidentSchema = z.object({
  date: isoDateSchema,
  kind: kindSchema,
  description: z.string().trim().min(1).max(200),
  amountEur: amountSchema.optional(),
  type: z.enum(['individual', 'shared']),
  responsibleUserId: userIdSchema.optional(),
});
type CreateIncidentBody = z.infer<typeof createIncidentSchema>;

/** Edición parcial: al menos un campo. `amountEur: null` borra el importe. */
export const updateIncidentSchema = z
  .object({
    date: isoDateSchema,
    kind: kindSchema,
    description: z.string().trim().min(1).max(200),
    amountEur: amountSchema.nullable(),
    type: z.enum(['individual', 'shared']),
    responsibleUserId: userIdSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'No hay ningún cambio que aplicar.',
  });
type UpdateIncidentBody = z.infer<typeof updateIncidentSchema>;

export const resolveIncidentSchema = z.object({
  paidBy: userIdSchema.optional(),
  amountEur: amountSchema.optional(),
});
type ResolveIncidentBody = z.infer<typeof resolveIncidentSchema>;

export const listIncidentsQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
});

export const incidentIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

function requireUserId(req: Request): number {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  return req.authUser.id;
}

function incidentId(req: Request): number {
  return Number(req.params.id);
}

/** GET /api/incidents?status= — abiertas primero. */
export const listIncidentsController: RequestHandler = (req, res) => {
  requireUserId(req);
  const { status } = req.query as z.infer<typeof listIncidentsQuerySchema>;
  res.json(ok(listIncidents(status)));
};

/** POST /api/incidents — registra una incidencia ABIERTA. */
export const createIncidentController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const body = req.body as CreateIncidentBody;
  res.status(201).json(ok(createIncident(userId, body)));
};

/** PATCH /api/incidents/:id — edita los datos (típicamente, ponerle el importe). */
export const updateIncidentController: RequestHandler = (req, res) => {
  requireUserId(req);
  const body = req.body as UpdateIncidentBody;
  res.json(ok(updateIncident(incidentId(req), body)));
};

/** PATCH /api/incidents/:id/resolve — ya se pagó o se reparó; entra en el saldo. */
export const resolveIncidentController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const body = req.body as ResolveIncidentBody;
  res.json(ok(resolveIncident(incidentId(req), userId, body)));
};

/** PATCH /api/incidents/:id/reopen — vuelve a abrirla; su importe sale del saldo. */
export const reopenIncidentController: RequestHandler = (req, res) => {
  requireUserId(req);
  res.json(ok(reopenIncident(incidentId(req))));
};

/** DELETE /api/incidents/:id */
export const deleteIncidentController: RequestHandler = (req, res) => {
  requireUserId(req);
  deleteIncident(incidentId(req));
  res.json(ok({ deleted: true }));
};
