import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getUsersById, listUsers } from './users.service.js';
import type { EntryType } from '../models/entry-type.js';
import type {
  IncidentDto,
  IncidentEntryDto,
  IncidentKind,
  IncidentRow,
  IncidentStatus,
} from '../models/incident.js';

/**
 * Incidencias del coche (multas, golpes, averías). Nacen ABIERTAS y pueden no tener importe
 * todavía; el coste solo entra en el saldo al RESOLVERLAS, a nombre de quien puso el dinero
 * (`paid_by`). Ver `getExpenses()` en `expenses.service.ts` para el mapeo al saldo.
 */

/** Redondeo monetario a 2 decimales. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toIncidentDto(row: IncidentRow): IncidentDto {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    description: row.description,
    amountEur: row.amount_eur == null ? null : round2(row.amount_eur),
    type: row.type,
    status: row.status,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/** Todas las filas, ABIERTAS primero y luego por fecha descendente. */
export function listIncidentRows(status?: IncidentStatus): IncidentRow[] {
  const where = status ? 'WHERE status = @status' : '';
  return db
    .prepare(
      `SELECT * FROM incidents ${where}
       ORDER BY (status = 'open') DESC, date DESC, id DESC`,
    )
    .all(status ? { status } : {}) as IncidentRow[];
}

function enrich(row: IncidentRow, usersById = getUsersById()): IncidentEntryDto {
  const reportedBy = usersById.get(row.reported_by);
  if (!reportedBy) {
    throw new AppError('NOT_FOUND', 'Usuario no encontrado.', 500);
  }
  return {
    ...toIncidentDto(row),
    reportedBy,
    responsible:
      row.responsible_user_id == null ? null : (usersById.get(row.responsible_user_id) ?? null),
    paidBy: row.paid_by == null ? null : (usersById.get(row.paid_by) ?? null),
  };
}

export function listIncidents(status?: IncidentStatus): IncidentEntryDto[] {
  const usersById = getUsersById();
  return listIncidentRows(status).map((row) => enrich(row, usersById));
}

function getRow(id: number): IncidentRow {
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', 'Incidencia no encontrada.', 404);
  }
  return row;
}

function assertUserExists(userId: number): void {
  if (!listUsers().some((u) => u.id === userId)) {
    throw new AppError('NOT_FOUND', 'Usuario no encontrado.', 404);
  }
}

/**
 * Responsable a persistir: solo tiene sentido en un reparto individual, y entonces es
 * OBLIGATORIO (lo garantiza también un CHECK). Por defecto, quien registra la incidencia.
 */
function resolveResponsible(
  type: EntryType,
  responsibleUserId: number | undefined,
  fallbackUserId: number,
): number | null {
  if (type !== 'individual') return null;
  const userId = responsibleUserId ?? fallbackUserId;
  assertUserExists(userId);
  return userId;
}

export interface CreateIncidentInput {
  date: string;
  kind: IncidentKind;
  description: string;
  amountEur?: number;
  type: EntryType;
  responsibleUserId?: number;
}

/** Registra una incidencia ABIERTA. El importe es opcional (puede añadirse al editarla). */
export function createIncident(reportedBy: number, input: CreateIncidentInput): IncidentEntryDto {
  const responsible = resolveResponsible(input.type, input.responsibleUserId, reportedBy);
  const result = db
    .prepare(
      `INSERT INTO incidents (reported_by, date, kind, description, amount_eur, type, responsible_user_id)
       VALUES (@reportedBy, @date, @kind, @description, @amountEur, @type, @responsible)`,
    )
    .run({
      reportedBy,
      date: input.date,
      kind: input.kind,
      description: input.description,
      amountEur: input.amountEur == null ? null : round2(input.amountEur),
      type: input.type,
      responsible,
    });
  return enrich(getRow(Number(result.lastInsertRowid)));
}

export interface UpdateIncidentInput {
  date?: string;
  kind?: IncidentKind;
  description?: string;
  /** `null` explícito borra el importe (vuelve a "sin importe"). */
  amountEur?: number | null;
  type?: EntryType;
  responsibleUserId?: number;
}

/**
 * Edita los datos de una incidencia (típicamente para ponerle el importe cuando llega la multa o
 * el presupuesto). NO cambia el estado: para eso están `resolveIncident` / `reopenIncident`.
 */
export function updateIncident(id: number, input: UpdateIncidentInput): IncidentEntryDto {
  const current = getRow(id);
  const type = input.type ?? current.type;
  const amountEur =
    input.amountEur === undefined
      ? current.amount_eur
      : input.amountEur == null
        ? null
        : round2(input.amountEur);

  // Si pasa a individual y no había responsable, se asume quien la registró (lo exige el CHECK).
  const responsible =
    type === 'individual'
      ? resolveResponsible(type, input.responsibleUserId ?? current.responsible_user_id ?? undefined, current.reported_by)
      : null;

  // Quitarle el importe a una resuelta dejaría un pagador huérfano: se limpia también.
  const paidBy = amountEur == null && current.status === 'resolved' ? null : current.paid_by;

  db.prepare(
    `UPDATE incidents
     SET date = @date, kind = @kind, description = @description, amount_eur = @amountEur,
         type = @type, responsible_user_id = @responsible, paid_by = @paidBy
     WHERE id = @id`,
  ).run({
    id,
    date: input.date ?? current.date,
    kind: input.kind ?? current.kind,
    description: input.description ?? current.description,
    amountEur,
    type,
    responsible,
    paidBy,
  });
  return enrich(getRow(id));
}

export interface ResolveIncidentInput {
  /** Quién puso el dinero. Por defecto, quien resuelve. */
  paidBy?: number;
  /** Permite ajustar el importe final al resolver (la factura no siempre es el presupuesto). */
  amountEur?: number;
}

/**
 * Marca la incidencia como resuelta (ya se pagó o ya se reparó) y, si tiene importe, la mete en el
 * saldo a nombre de `paidBy`. La transición es ATÓMICA (`WHERE status = 'open'`): si los dos
 * móviles la resuelven a la vez, el segundo recibe 409 en vez de duplicar el efecto.
 */
export function resolveIncident(
  id: number,
  actingUserId: number,
  input: ResolveIncidentInput = {},
): IncidentEntryDto {
  const current = getRow(id);
  const amountEur =
    input.amountEur === undefined ? current.amount_eur : round2(input.amountEur);
  // Sin importe no hay dinero que atribuir: se resuelve sin pagador.
  let paidBy: number | null = null;
  if (amountEur != null) {
    paidBy = input.paidBy ?? actingUserId;
    assertUserExists(paidBy);
  }

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE incidents
         SET status = 'resolved', paid_by = @paidBy, amount_eur = @amountEur,
             resolved_at = datetime('now')
         WHERE id = @id AND status = 'open'`,
      )
      .run({ id, paidBy, amountEur });
    if (result.changes === 0) {
      throw new AppError('INVALID_TRANSITION', 'La incidencia ya estaba resuelta.', 409);
    }
  });
  run();

  return enrich(getRow(id));
}

/** Vuelve a abrir una incidencia resuelta: limpia el pagador, así su importe SALE del saldo. */
export function reopenIncident(id: number): IncidentEntryDto {
  getRow(id);
  const result = db
    .prepare(
      `UPDATE incidents
       SET status = 'open', paid_by = NULL, resolved_at = NULL
       WHERE id = @id AND status = 'resolved'`,
    )
    .run({ id });
  if (result.changes === 0) {
    throw new AppError('INVALID_TRANSITION', 'La incidencia ya estaba abierta.', 409);
  }
  return enrich(getRow(id));
}

/** Elimina una incidencia. Si estaba resuelta con importe, su efecto sale del saldo. */
export function deleteIncident(id: number): void {
  const result = db.prepare('DELETE FROM incidents WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new AppError('NOT_FOUND', 'Incidencia no encontrada.', 404);
  }
}
