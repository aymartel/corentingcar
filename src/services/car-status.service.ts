import { db } from '../db/connection.js';
import { findUserById, findUserByProfile, toUserDto } from './users.service.js';
import type {
  CarStatusEventRow,
  CarStatusDto,
  CarAvailability,
  ParkingSpot,
} from '../models/car-status.js';

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
    return { status: 'free', user: null, parking: null, parkingUser: null, note: null, since: null };
  }

  const user = findUserById(row.user_id);
  // 'other' no corresponde a ninguna persona → sin parkingUser (la ubicación va en `note`).
  const parkingUser =
    row.parking === 'user1' || row.parking === 'user2'
      ? findUserByProfile(row.parking)
      : undefined;
  return {
    status: row.status,
    user: user ? toUserDto(user) : null,
    parking: row.parking,
    parkingUser: parkingUser ? toUserDto(parkingUser) : null,
    note: row.note,
    since: toIsoUtc(row.created_at),
  };
}

/** Registra un cambio de estado realizado por `userId` y devuelve el estado resultante. */
export function setCarStatus(
  userId: number,
  input: { status: CarAvailability; parking?: ParkingSpot; note?: string },
): CarStatusDto {
  db.prepare(
    'INSERT INTO car_status_events (user_id, status, parking, note) VALUES (?, ?, ?, ?)',
  ).run(userId, input.status, input.parking ?? null, input.note ?? null);
  return getCarStatus();
}
