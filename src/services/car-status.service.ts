import { db } from '../db/connection.js';
import { findUserById, toUserDto } from './users.service.js';
import type { CarStatusEventRow, CarStatusDto, CarAvailability } from '../models/car-status.js';

/** Convierte el 'YYYY-MM-DD HH:MM:SS' (UTC) de SQLite a ISO 8601 con Z. */
function toIsoUtc(sqliteDatetime: string): string {
  return new Date(`${sqliteDatetime.replace(' ', 'T')}Z`).toISOString();
}

/** Estado actual del coche = último evento. Si no hay eventos, se asume libre. */
export function getCarStatus(): CarStatusDto {
  const row = db
    .prepare('SELECT * FROM car_status_events ORDER BY id DESC LIMIT 1')
    .get() as CarStatusEventRow | undefined;

  if (!row) {
    return { status: 'free', user: null, note: null, since: null };
  }

  const user = findUserById(row.user_id);
  return {
    status: row.status,
    user: user ? toUserDto(user) : null,
    note: row.note,
    since: toIsoUtc(row.created_at),
  };
}

/** Registra un cambio de estado realizado por `userId` y devuelve el estado resultante. */
export function setCarStatus(
  userId: number,
  input: { status: CarAvailability; note?: string },
): CarStatusDto {
  db.prepare('INSERT INTO car_status_events (user_id, status, note) VALUES (?, ?, ?)').run(
    userId,
    input.status,
    input.note ?? null,
  );
  return getCarStatus();
}
