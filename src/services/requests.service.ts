import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getUsersById } from './users.service.js';
import { getPriorityForDate } from './priority.service.js';
import { upsertHandover } from './handover.service.js';
import type { UserDto } from '../models/user.js';
import type { RequestRow, RequestDto, RequestEntryDto, RequestStatus } from '../models/request.js';

function rowToDto(row: RequestRow): RequestDto {
  return {
    id: row.id,
    requesterId: row.requester_id,
    recipientId: row.recipient_id,
    useDate: row.use_date,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function requireUser(usersById: Map<number, UserDto>, id: number): UserDto {
  const user = usersById.get(id);
  if (!user) throw new AppError('NOT_FOUND', `Usuario ${id} no encontrado.`, 404);
  return user;
}

function getRequestRow(id: number): RequestRow | undefined {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;
}

function enrich(row: RequestRow, usersById = getUsersById()): RequestEntryDto {
  return {
    ...rowToDto(row),
    requester: requireUser(usersById, row.requester_id),
    recipient: requireUser(usersById, row.recipient_id),
  };
}

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    String((err as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  );
}

/**
 * Crea una solicitud para `useDate`. `recipient` = quien tiene prioridad efectiva ese día.
 * No se puede pedir un día propio ni duplicar una pendiente para la misma fecha.
 */
export function createRequest(
  requesterId: number,
  input: { useDate: string; message?: string },
): RequestEntryDto {
  const recipientId = getPriorityForDate(input.useDate).priorityUser.id;
  if (recipientId === requesterId) {
    throw new AppError(
      'CANNOT_REQUEST_OWN_DAY',
      'Ya tienes prioridad ese día; no necesitas solicitarlo.',
      400,
    );
  }

  const existing = db
    .prepare(`SELECT id FROM requests WHERE requester_id = ? AND use_date = ? AND status = 'pending'`)
    .get(requesterId, input.useDate);
  if (existing) {
    throw new AppError(
      'DUPLICATE_PENDING_REQUEST',
      'Ya tienes una solicitud pendiente para esa fecha.',
      409,
    );
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO requests (requester_id, recipient_id, use_date, status, message)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(requesterId, recipientId, input.useDate, input.message ?? null);
    const row = getRequestRow(Number(result.lastInsertRowid));
    if (!row) throw new AppError('INTERNAL_ERROR', 'No se pudo crear la solicitud.', 500);
    return enrich(row);
  } catch (err) {
    if (isUniqueConstraint(err)) {
      throw new AppError(
        'DUPLICATE_PENDING_REQUEST',
        'Ya tienes una solicitud pendiente para esa fecha.',
        409,
      );
    }
    throw err;
  }
}

type ActorRole = 'recipient' | 'requester';

/**
 * Transición atómica `pending` → `toStatus`. Verifica el rol que actúa (recipient/requester),
 * usa `UPDATE ... WHERE status='pending'` para evitar doble resolución, y ejecuta `onSuccess`
 * dentro de la misma transacción (p.ej. crear el handover al aceptar).
 */
function transition(
  requestId: number,
  actingUserId: number,
  role: ActorRole,
  toStatus: Exclude<RequestStatus, 'pending'>,
  onSuccess?: (row: RequestRow) => void,
): RequestEntryDto {
  const row = getRequestRow(requestId);
  if (!row) throw new AppError('NOT_FOUND', 'Solicitud no encontrada.', 404);

  const allowedActor = role === 'recipient' ? row.recipient_id : row.requester_id;
  if (actingUserId !== allowedActor) {
    throw new AppError('FORBIDDEN', 'No puedes realizar esta acción sobre la solicitud.', 403);
  }

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE requests SET status = @status, resolved_at = datetime('now')
         WHERE id = @id AND status = 'pending'`,
      )
      .run({ status: toStatus, id: requestId });
    if (result.changes === 0) {
      throw new AppError('INVALID_TRANSITION', 'La solicitud ya no está pendiente.', 409);
    }
    if (onSuccess) onSuccess(row);
  });
  run();

  const updated = getRequestRow(requestId);
  if (!updated) throw new AppError('INTERNAL_ERROR', 'Solicitud no encontrada tras actualizar.', 500);
  return enrich(updated);
}

/** El recipient acepta: pending → accepted y crea/actualiza el handover (cesión puntual). */
export function acceptRequest(requestId: number, actingUserId: number): RequestEntryDto {
  return transition(requestId, actingUserId, 'recipient', 'accepted', (row) => {
    upsertHandover({
      date: row.use_date,
      effectivePriorityUserId: row.requester_id,
      origin: 'request_accepted',
      requestId: row.id,
    });
  });
}

/** El recipient rechaza: pending → rejected (sin efecto sobre la prioridad). */
export function rejectRequest(requestId: number, actingUserId: number): RequestEntryDto {
  return transition(requestId, actingUserId, 'recipient', 'rejected');
}

/** El requester cancela su propia solicitud pendiente: pending → cancelled. */
export function cancelRequest(requestId: number, actingUserId: number): RequestEntryDto {
  return transition(requestId, actingUserId, 'requester', 'cancelled');
}

/** Lista solicitudes en las que participa el usuario (enviadas o recibidas), filtrable por estado. */
export function listRequests(userId: number, status?: RequestStatus): RequestEntryDto[] {
  const conditions = ['(requester_id = @userId OR recipient_id = @userId)'];
  const params: Record<string, unknown> = { userId };
  if (status) {
    conditions.push('status = @status');
    params.status = status;
  }
  const rows = db
    .prepare(
      `SELECT * FROM requests WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC`,
    )
    .all(params) as RequestRow[];
  const usersById = getUsersById();
  return rows.map((row) => enrich(row, usersById));
}

/** Solicitudes pendientes dirigidas al usuario (las que requieren su acción → badge in-app). */
export function listPendingForUser(userId: number): RequestEntryDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM requests WHERE recipient_id = ? AND status = 'pending'
       ORDER BY created_at DESC, id DESC`,
    )
    .all(userId) as RequestRow[];
  const usersById = getUsersById();
  return rows.map((row) => enrich(row, usersById));
}
