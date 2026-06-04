import type { UserDto } from './user.js';

/** Estados de una solicitud de uso (máquina de estados). */
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

/** Fila `requests` tal cual en la base de datos. */
export interface RequestRow {
  id: number;
  requester_id: number;
  recipient_id: number;
  use_date: string;
  status: RequestStatus;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** DTO de solicitud para la API (camelCase). */
export interface RequestDto {
  id: number;
  requesterId: number;
  recipientId: number;
  useDate: string;
  status: RequestStatus;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** DTO enriquecido con los usuarios (para listas y badge en la app). */
export interface RequestEntryDto extends RequestDto {
  requester: UserDto;
  recipient: UserDto;
}
