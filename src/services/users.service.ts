import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import type { UserRow, UserDto } from '../models/user.js';

/** Convierte una fila de BD en DTO público (sin `pin_hash`). */
export function toUserDto(row: UserRow): UserDto {
  return { id: row.id, name: row.name, profile: row.profile, color: row.color };
}

/** Lista los perfiles disponibles para la pantalla de selección (sin `pin_hash`). */
export function listUsers(): UserDto[] {
  return db
    .prepare('SELECT id, name, profile, color FROM users ORDER BY id')
    .all() as UserDto[];
}

export function findUserByProfile(profile: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE profile = ?').get(profile) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/** Mapa id → DTO de todos los usuarios (sin `pin_hash`). */
export function getUsersById(): Map<number, UserDto> {
  const rows = db.prepare('SELECT id, name, profile, color FROM users').all() as UserDto[];
  return new Map(rows.map((user) => [user.id, user]));
}

/** Devuelve el id del OTRO usuario (solo hay 2). Lanza si no existe un segundo usuario. */
export function getOtherUserId(userId: number): number {
  const row = db
    .prepare('SELECT id FROM users WHERE id != ? ORDER BY id LIMIT 1')
    .get(userId) as { id: number } | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', 'No hay un segundo usuario sembrado.', 500);
  }
  return row.id;
}
