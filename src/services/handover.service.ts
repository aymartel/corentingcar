import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { findUserById } from './users.service.js';
import type { HandoverRow, HandoverOrigin, HandoverDto } from '../models/handover.js';

export function getHandover(date: string): HandoverRow | undefined {
  return db.prepare('SELECT * FROM handovers WHERE date = ?').get(date) as HandoverRow | undefined;
}

/** Mapa fecha → handover para un mes `YYYY-MM`. */
export function getHandoversForMonth(month: string): Map<string, HandoverRow> {
  const rows = db
    .prepare('SELECT * FROM handovers WHERE date LIKE ?')
    .all(`${month}-%`) as HandoverRow[];
  return new Map(rows.map((row) => [row.date, row]));
}

/**
 * Crea o actualiza el override de un día con política **el último gana** (upsert atómico
 * sobre `UNIQUE(date)`). Reutilizable por B7 (al aceptar una solicitud, con `request_id`).
 */
export function upsertHandover(input: {
  date: string;
  effectivePriorityUserId: number;
  origin: HandoverOrigin;
  requestId?: number | null;
}): HandoverRow {
  if (!findUserById(input.effectivePriorityUserId)) {
    throw new AppError('VALIDATION_ERROR', `Usuario ${input.effectivePriorityUserId} inexistente.`, 400);
  }

  db.prepare(
    `INSERT INTO handovers (date, effective_priority_user_id, origin, request_id)
     VALUES (@date, @user, @origin, @requestId)
     ON CONFLICT(date) DO UPDATE SET
       effective_priority_user_id = excluded.effective_priority_user_id,
       origin = excluded.origin,
       request_id = excluded.request_id,
       created_at = datetime('now')`,
  ).run({
    date: input.date,
    user: input.effectivePriorityUserId,
    origin: input.origin,
    requestId: input.requestId ?? null,
  });

  const row = getHandover(input.date);
  if (!row) {
    throw new AppError('INTERNAL_ERROR', 'No se pudo guardar el handover.', 500);
  }
  return row;
}

/** Elimina el override de un día (vuelve a la alternancia base). */
export function deleteHandover(date: string): boolean {
  return db.prepare('DELETE FROM handovers WHERE date = ?').run(date).changes > 0;
}

export function handoverToDto(row: HandoverRow): HandoverDto {
  return {
    date: row.date,
    effectivePriorityUserId: row.effective_priority_user_id,
    origin: row.origin,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}
