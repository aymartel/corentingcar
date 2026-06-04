/** Perfil de usuario (estable). */
export type Profile = 'andy' | 'amigo';

/** Fila `users` tal cual en la base de datos (incluye `pin_hash`, uso interno). */
export interface UserRow {
  id: number;
  name: string;
  profile: Profile;
  pin_hash: string;
  color: string | null;
  created_at: string;
}

/** DTO público de usuario para la API. NUNCA incluye `pin_hash`. */
export interface UserDto {
  id: number;
  name: string;
  profile: Profile;
  color: string | null;
}
