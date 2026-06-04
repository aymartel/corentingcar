import { randomBytes } from 'node:crypto';
import { db } from '../db/connection.js';
import { verifyPin } from '../utils/pin.js';
import { AppError } from '../utils/app-error.js';
import { findUserByProfile, toUserDto } from './users.service.js';
import type { UserDto } from '../models/user.js';

/**
 * Sesión simple basada en token opaco guardado en la tabla `sessions` (en vez de JWT):
 * permite invalidar (logout) y caducar de forma explícita, y es suficiente para 2 usuarios.
 */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

interface SessionUserRow {
  id: number;
  name: string;
  profile: UserDto['profile'];
  color: string | null;
  expires_at: string;
}

/** Valida perfil + PIN y crea una sesión. Lanza 401 si las credenciales no son válidas. */
export function login(profile: string, pin: string): { token: string; user: UserDto } {
  const user = findUserByProfile(profile);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    throw new AppError('INVALID_CREDENTIALS', 'Perfil o PIN incorrectos.', 401);
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    expiresAt,
  );

  return { token, user: toUserDto(user) };
}

/** Invalida (borra) la sesión del token. */
export function logout(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Devuelve el usuario de un token válido y no caducado, o null. Limpia sesiones caducadas. */
export function getUserByToken(token: string): UserDto | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.profile, u.color, s.expires_at AS expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as SessionUserRow | undefined;

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return { id: row.id, name: row.name, profile: row.profile, color: row.color };
}
