import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getUsersById, getOtherUserId } from './users.service.js';
import { getUsageRowById, assertNoOdometerOverlap } from './usage.service.js';
import type { UserDto } from '../models/user.js';
import type { UsageType } from '../models/usage.js';
import type {
  UsageChangeRow,
  UsageChangeDto,
  UsageChangeEntryDto,
  UsageChangeStatus,
  UsageChangeFieldsDto,
} from '../models/usage-change.js';

function fieldsOrNull(
  userId: number | null,
  date: string | null,
  startKm: number | null,
  endKm: number | null,
  type: UsageType | null,
): UsageChangeFieldsDto | null {
  if (userId == null || date == null || startKm == null || endKm == null || type == null) {
    return null;
  }
  return { userId, date, startKm, endKm, type };
}

function rowToDto(row: UsageChangeRow): UsageChangeDto {
  return {
    id: row.id,
    kind: row.kind,
    requesterId: row.requester_id,
    recipientId: row.recipient_id,
    usageId: row.usage_id,
    proposed:
      row.kind === 'delete'
        ? null
        : fieldsOrNull(row.user_id, row.date, row.start_km, row.end_km, row.type),
    original:
      row.kind === 'create'
        ? null
        : fieldsOrNull(
            row.prev_user_id,
            row.prev_date,
            row.prev_start_km,
            row.prev_end_km,
            row.prev_type,
          ),
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function requireUser(usersById: Map<number, UserDto>, id: number): UserDto {
  const user = usersById.get(id);
  if (!user) throw new AppError('NOT_FOUND', `Usuario ${id} no encontrado.`, 404);
  return user;
}

function getChangeRow(id: number): UsageChangeRow | undefined {
  return db.prepare('SELECT * FROM usage_change_requests WHERE id = ?').get(id) as
    | UsageChangeRow
    | undefined;
}

function enrich(row: UsageChangeRow, usersById = getUsersById()): UsageChangeEntryDto {
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

/** Los campos propuestos deben estar completos (garantizado por el CHECK del esquema). */
function requireProposed(row: UsageChangeRow): UsageChangeFieldsDto {
  const fields = fieldsOrNull(row.user_id, row.date, row.start_km, row.end_km, row.type);
  if (!fields) throw new AppError('INTERNAL_ERROR', 'Cambio de uso con campos incompletos.', 500);
  return fields;
}

/** `usage_id` no nulo (garantizado por el CHECK para update/delete). */
function requireUsageId(row: UsageChangeRow): number {
  if (row.usage_id == null) throw new AppError('INTERNAL_ERROR', 'Cambio sin usage_id.', 500);
  return row.usage_id;
}

export type CreateUsageChangeInput =
  | {
      kind: 'create';
      date: string;
      startKm: number;
      endKm: number;
      type: UsageType;
      userId?: number;
      reason?: string;
    }
  | {
      kind: 'update';
      usageId: number;
      date: string;
      startKm: number;
      endKm: number;
      type: UsageType;
      userId?: number;
      reason?: string;
    }
  | { kind: 'delete'; usageId: number; reason?: string };

function assertNoPendingForUsage(usageId: number): void {
  const existing = db
    .prepare(`SELECT id FROM usage_change_requests WHERE usage_id = ? AND status = 'pending'`)
    .get(usageId);
  if (existing) {
    throw new AppError(
      'DUPLICATE_PENDING_CHANGE',
      'Ya hay un cambio pendiente para este registro de uso.',
      409,
    );
  }
}

/**
 * Crea un cambio de uso pendiente de aprobación. `recipient` = SIEMPRE el otro usuario
 * (el no-solicitante), aunque el uso editado sea propio. No aplica nada sobre `usage_logs`
 * hasta que el recipient lo apruebe.
 */
export function createUsageChange(
  requesterId: number,
  input: CreateUsageChangeInput,
): UsageChangeEntryDto {
  const recipientId = getOtherUserId(requesterId);

  let usageId: number | null = null;
  let userId: number | null = null;
  let date: string | null = null;
  let startKm: number | null = null;
  let endKm: number | null = null;
  let type: UsageType | null = null;
  let prevUserId: number | null = null;
  let prevDate: string | null = null;
  let prevStartKm: number | null = null;
  let prevEndKm: number | null = null;
  let prevType: UsageType | null = null;

  if (input.kind === 'create') {
    userId = input.userId ?? requesterId;
    date = input.date;
    startKm = input.startKm;
    endKm = input.endKm;
    type = input.type;
    assertNoOdometerOverlap(startKm, endKm); // 400 al proponer
  } else {
    const target = getUsageRowById(input.usageId);
    if (!target) {
      throw new AppError('NOT_FOUND', 'Registro de uso no encontrado.', 404);
    }
    assertNoPendingForUsage(input.usageId);
    usageId = input.usageId;
    prevUserId = target.user_id;
    prevDate = target.date;
    prevStartKm = target.start_km;
    prevEndKm = target.end_km;
    prevType = target.type;
    if (input.kind === 'update') {
      userId = input.userId ?? target.user_id;
      date = input.date;
      startKm = input.startKm;
      endKm = input.endKm;
      type = input.type;
      assertNoOdometerOverlap(startKm, endKm, { excludeUsageId: input.usageId }); // 400
    }
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO usage_change_requests
           (requester_id, recipient_id, kind, usage_id, user_id, date, start_km, end_km, type,
            prev_user_id, prev_date, prev_start_km, prev_end_km, prev_type, reason, status)
         VALUES
           (@requesterId, @recipientId, @kind, @usageId, @userId, @date, @startKm, @endKm, @type,
            @prevUserId, @prevDate, @prevStartKm, @prevEndKm, @prevType, @reason, 'pending')`,
      )
      .run({
        requesterId,
        recipientId,
        kind: input.kind,
        usageId,
        userId,
        date,
        startKm,
        endKm,
        type,
        prevUserId,
        prevDate,
        prevStartKm,
        prevEndKm,
        prevType,
        reason: input.reason ?? null,
      });
    const row = getChangeRow(Number(result.lastInsertRowid));
    if (!row) throw new AppError('INTERNAL_ERROR', 'No se pudo crear el cambio de uso.', 500);
    return enrich(row);
  } catch (err) {
    if (isUniqueConstraint(err)) {
      throw new AppError(
        'DUPLICATE_PENDING_CHANGE',
        'Ya hay un cambio pendiente para este registro de uso.',
        409,
      );
    }
    throw err;
  }
}

type ActorRole = 'recipient' | 'requester';

/**
 * Transición atómica `pending` → `toStatus`, verificando el rol. `apply` se ejecuta dentro de
 * la misma transacción: si lanza (p.ej. el odómetro cambió), se revierte y el cambio sigue pendiente.
 */
function transition(
  changeId: number,
  actingUserId: number,
  role: ActorRole,
  toStatus: Exclude<UsageChangeStatus, 'pending'>,
  apply?: (row: UsageChangeRow) => void,
): UsageChangeEntryDto {
  const row = getChangeRow(changeId);
  if (!row) throw new AppError('NOT_FOUND', 'Cambio de uso no encontrado.', 404);

  const allowedActor = role === 'recipient' ? row.recipient_id : row.requester_id;
  if (actingUserId !== allowedActor) {
    throw new AppError('FORBIDDEN', 'No puedes realizar esta acción sobre este cambio.', 403);
  }

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE usage_change_requests SET status = @status, resolved_at = datetime('now')
         WHERE id = @id AND status = 'pending'`,
      )
      .run({ status: toStatus, id: changeId });
    if (result.changes === 0) {
      throw new AppError('INVALID_TRANSITION', 'El cambio ya no está pendiente.', 409);
    }
    if (apply) apply(row);
  });
  run();

  const updated = getChangeRow(changeId);
  if (!updated) throw new AppError('INTERNAL_ERROR', 'Cambio no encontrado tras actualizar.', 500);
  return enrich(updated);
}

/** Aplica el cambio sobre `usage_logs` (dentro de la transacción de aprobación). */
function applyChange(row: UsageChangeRow): void {
  if (row.kind === 'create') {
    const { userId, date, startKm, endKm, type } = requireProposed(row);
    assertNoOdometerOverlap(startKm, endKm, { httpStatus: 409 });
    db.prepare(
      `INSERT INTO usage_logs (user_id, date, start_km, end_km, total_km, type)
       VALUES (@userId, @date, @startKm, @endKm, @totalKm, @type)`,
    ).run({ userId, date, startKm, endKm, totalKm: endKm - startKm, type });
    return;
  }

  const usageId = requireUsageId(row);
  const target = getUsageRowById(usageId);
  if (!target) throw new AppError('CONFLICT', 'El registro de uso ya no existe.', 409);

  if (row.kind === 'update') {
    const { userId, date, startKm, endKm, type } = requireProposed(row);
    assertNoOdometerOverlap(startKm, endKm, { excludeUsageId: usageId, httpStatus: 409 });
    db.prepare(
      `UPDATE usage_logs SET user_id = @userId, date = @date, start_km = @startKm,
         end_km = @endKm, total_km = @totalKm, type = @type WHERE id = @id`,
    ).run({ id: usageId, userId, date, startKm, endKm, totalKm: endKm - startKm, type });
  } else {
    db.prepare('DELETE FROM usage_logs WHERE id = ?').run(usageId);
  }
}

/** El recipient aprueba: pending → approved y aplica el cambio (insert/update/delete). */
export function approveUsageChange(id: number, actingUserId: number): UsageChangeEntryDto {
  return transition(id, actingUserId, 'recipient', 'approved', applyChange);
}

/** El recipient rechaza: pending → rejected (sin efecto sobre `usage_logs`). */
export function rejectUsageChange(id: number, actingUserId: number): UsageChangeEntryDto {
  return transition(id, actingUserId, 'recipient', 'rejected');
}

/** El requester cancela su propio cambio pendiente: pending → cancelled. */
export function cancelUsageChange(id: number, actingUserId: number): UsageChangeEntryDto {
  return transition(id, actingUserId, 'requester', 'cancelled');
}

/** Lista cambios en los que participa el usuario (propuestos o recibidos), filtrable por estado. */
export function listUsageChanges(
  userId: number,
  status?: UsageChangeStatus,
): UsageChangeEntryDto[] {
  const conditions = ['(requester_id = @userId OR recipient_id = @userId)'];
  const params: Record<string, unknown> = { userId };
  if (status) {
    conditions.push('status = @status');
    params.status = status;
  }
  const rows = db
    .prepare(
      `SELECT * FROM usage_change_requests WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC`,
    )
    .all(params) as UsageChangeRow[];
  const usersById = getUsersById();
  return rows.map((row) => enrich(row, usersById));
}

/** Cambios pendientes dirigidos al usuario (requieren su aprobación → badge in-app). */
export function listPendingUsageChangesForUser(userId: number): UsageChangeEntryDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM usage_change_requests WHERE recipient_id = ? AND status = 'pending'
       ORDER BY created_at DESC, id DESC`,
    )
    .all(userId) as UsageChangeRow[];
  const usersById = getUsersById();
  return rows.map((row) => enrich(row, usersById));
}
