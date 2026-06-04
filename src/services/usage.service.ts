import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import type { UsageRow, UsageDto, UsageType } from '../models/usage.js';

function toUsageDto(row: UsageRow): UsageDto {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    startKm: row.start_km,
    endKm: row.end_km,
    totalKm: row.total_km,
    type: row.type,
    createdAt: row.created_at,
  };
}

/**
 * Registra un uso. `totalKm` se calcula en el SERVIDOR (nunca se confía en el cliente).
 * Valida continuidad del odómetro: `startKm` no puede ser menor que el mayor `end_km` ya
 * registrado del coche (evita retrocesos/solapes).
 */
export function createUsage(
  userId: number,
  input: { date: string; startKm: number; endKm: number; type: UsageType },
): UsageDto {
  if (input.endKm < input.startKm) {
    throw new AppError('VALIDATION_ERROR', 'endKm debe ser mayor o igual que startKm.', 400);
  }

  const last = db.prepare('SELECT MAX(end_km) AS maxEnd FROM usage_logs').get() as {
    maxEnd: number | null;
  };
  if (last.maxEnd != null && input.startKm < last.maxEnd) {
    throw new AppError(
      'ODOMETER_INCONSISTENT',
      `startKm (${input.startKm} km) es menor que el último odómetro conocido (${last.maxEnd} km).`,
      400,
    );
  }

  const totalKm = input.endKm - input.startKm;
  const result = db
    .prepare(
      `INSERT INTO usage_logs (user_id, date, start_km, end_km, total_km, type)
       VALUES (@userId, @date, @startKm, @endKm, @totalKm, @type)`,
    )
    .run({
      userId,
      date: input.date,
      startKm: input.startKm,
      endKm: input.endKm,
      totalKm,
      type: input.type,
    });

  const row = db
    .prepare('SELECT * FROM usage_logs WHERE id = ?')
    .get(result.lastInsertRowid) as UsageRow;
  return toUsageDto(row);
}

/** Lista registros de uso con filtros opcionales por usuario y rango de fechas. */
export function listUsage(filters: { userId?: number; from?: string; to?: string }): UsageDto[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.userId != null) {
    conditions.push('user_id = @userId');
    params.userId = filters.userId;
  }
  if (filters.from) {
    conditions.push('date >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('date <= @to');
    params.to = filters.to;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT * FROM usage_logs ${where} ORDER BY date DESC, id DESC`);
  const rows = (conditions.length > 0 ? stmt.all(params) : stmt.all()) as UsageRow[];
  return rows.map(toUsageDto);
}
