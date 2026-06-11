import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import {
  createUsageChange,
  listUsageChanges,
  listPendingUsageChangesForUser,
  approveUsageChange,
  rejectUsageChange,
  cancelUsageChange,
  type CreateUsageChangeInput,
} from '../services/usage-changes.service.js';

const reasonSchema = z.string().trim().max(500).optional();

/**
 * Cuerpo de POST /api/usage/changes. Unión discriminada por `kind`.
 * En zod v3 los miembros deben ser `ZodObject` planos: el refine `endKm >= startKm` va
 * en `.superRefine` de la unión, no por miembro.
 */
export const createUsageChangeSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create'),
      date: isoDateSchema,
      startKm: z.number().int().min(0),
      endKm: z.number().int().min(0),
      type: z.enum(['individual', 'shared']),
      userId: z.number().int().positive().optional(),
      reason: reasonSchema,
    }),
    z.object({
      kind: z.literal('update'),
      usageId: z.number().int().positive(),
      date: isoDateSchema,
      startKm: z.number().int().min(0),
      endKm: z.number().int().min(0),
      type: z.enum(['individual', 'shared']),
      userId: z.number().int().positive().optional(),
      reason: reasonSchema,
    }),
    z.object({
      kind: z.literal('delete'),
      usageId: z.number().int().positive(),
      reason: reasonSchema,
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.kind !== 'delete' && d.endKm < d.startKm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endKm'],
        message: 'endKm debe ser mayor o igual que startKm.',
      });
    }
  });

type CreateUsageChangeBody = z.infer<typeof createUsageChangeSchema>;

/** Filtro de GET /api/usage/changes. */
export const listUsageChangesQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

type ListUsageChangesQuery = z.infer<typeof listUsageChangesQuerySchema>;

function requireUserId(req: Parameters<RequestHandler>[0]): number {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  return req.authUser.id;
}

/** POST /api/usage/changes — propone un cambio (requester = usuario autenticado). */
export const createUsageChangeController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const body = req.body as CreateUsageChangeBody;
  res.status(201).json(ok(createUsageChange(userId, body as CreateUsageChangeInput)));
};

/** GET /api/usage/changes?status= — cambios en los que participa el usuario. */
export const listUsageChangesController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { status } = req.query as ListUsageChangesQuery;
  res.json(ok(listUsageChanges(userId, status)));
};

/** GET /api/usage/changes/pending — pendientes dirigidos al usuario (badge in-app). */
export const listPendingUsageChangesController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  res.json(ok(listPendingUsageChangesForUser(userId)));
};

/** PATCH /api/usage/changes/:id/approve */
export const approveUsageChangeController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(approveUsageChange(id, userId)));
};

/** PATCH /api/usage/changes/:id/reject */
export const rejectUsageChangeController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(rejectUsageChange(id, userId)));
};

/** PATCH /api/usage/changes/:id/cancel */
export const cancelUsageChangeController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(cancelUsageChange(id, userId)));
};
