import type { UserDto } from './user.js';
import type { UsageType } from './usage.js';

/** Tipo de cambio propuesto sobre un uso. */
export type UsageChangeKind = 'create' | 'update' | 'delete';

/** Estados de un cambio de uso (misma máquina de estados que las solicitudes). */
export type UsageChangeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Fila `usage_change_requests` tal cual en la base de datos. */
export interface UsageChangeRow {
  id: number;
  requester_id: number;
  recipient_id: number;
  kind: UsageChangeKind;
  usage_id: number | null;
  user_id: number | null;
  date: string | null;
  start_km: number | null;
  end_km: number | null;
  type: UsageType | null;
  prev_user_id: number | null;
  prev_date: string | null;
  prev_start_km: number | null;
  prev_end_km: number | null;
  prev_type: UsageType | null;
  reason: string | null;
  status: UsageChangeStatus;
  created_at: string;
  resolved_at: string | null;
}

/** Conjunto de campos de un uso (propuesto u original). Distancias en km. */
export interface UsageChangeFieldsDto {
  userId: number;
  date: string;
  startKm: number;
  endKm: number;
  type: UsageType;
}

/** DTO de cambio de uso para la API (camelCase). */
export interface UsageChangeDto {
  id: number;
  kind: UsageChangeKind;
  requesterId: number;
  recipientId: number;
  usageId: number | null;
  /** Valores propuestos. `null` para `delete`. */
  proposed: UsageChangeFieldsDto | null;
  /** Snapshot de los valores previos (prev_*). `null` para `create`. */
  original: UsageChangeFieldsDto | null;
  reason: string | null;
  status: UsageChangeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

/** DTO enriquecido con los usuarios (para listas y badge en la app). */
export interface UsageChangeEntryDto extends UsageChangeDto {
  requester: UserDto;
  recipient: UserDto;
}
