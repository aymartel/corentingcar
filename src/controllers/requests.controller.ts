import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { isoDateSchema } from '../utils/validation.js';
import {
  createRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  listRequests,
  listPendingForUser,
} from '../services/requests.service.js';

/** Cuerpo de POST /api/requests. */
export const createRequestSchema = z.object({
  useDate: isoDateSchema,
  message: z.string().trim().max(500).optional(),
});

type CreateRequestBody = z.infer<typeof createRequestSchema>;

/** Filtro de GET /api/requests. */
export const listRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(),
});

type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/** Param :id (llega como string en la URL → se coacciona). */
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function requireUserId(req: Parameters<RequestHandler>[0]): number {
  if (!req.authUser) throw new AppError('UNAUTHENTICATED', 'No autenticado.', 401);
  return req.authUser.id;
}

/** POST /api/requests — crea una solicitud (requester = usuario autenticado). */
export const createRequestController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const body = req.body as CreateRequestBody;
  res.status(201).json(ok(createRequest(userId, body)));
};

/** GET /api/requests?status= — solicitudes en las que participa el usuario. */
export const listRequestsController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { status } = req.query as ListRequestsQuery;
  res.json(ok(listRequests(userId, status)));
};

/** GET /api/requests/pending — pendientes dirigidas al usuario (badge in-app). */
export const listPendingController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  res.json(ok(listPendingForUser(userId)));
};

/** PATCH /api/requests/:id/accept */
export const acceptRequestController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(acceptRequest(id, userId)));
};

/** PATCH /api/requests/:id/reject */
export const rejectRequestController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(rejectRequest(id, userId)));
};

/** PATCH /api/requests/:id/cancel */
export const cancelRequestController: RequestHandler = (req, res) => {
  const userId = requireUserId(req);
  const { id } = req.params as unknown as { id: number };
  res.json(ok(cancelRequest(id, userId)));
};
