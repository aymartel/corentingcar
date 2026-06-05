import type { UserDto } from './user.js';

/** Disponibilidad del coche en tiempo real. */
export type CarAvailability = 'free' | 'taken';

/** Fila `car_status_events` tal cual en la base de datos. */
export interface CarStatusEventRow {
  id: number;
  user_id: number;
  status: CarAvailability;
  note: string | null;
  created_at: string;
}

/** DTO del estado actual del coche (estado = último evento). */
export interface CarStatusDto {
  status: CarAvailability;
  /** Quién lo tiene (si 'taken') o quién lo dejó libre (si 'free'). null si nunca se registró. */
  user: UserDto | null;
  note: string | null;
  /** Fecha-hora del cambio en ISO 8601 UTC, o null si nunca se registró. */
  since: string | null;
}
