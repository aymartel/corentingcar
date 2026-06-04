/** Origen de un override de prioridad. */
export type HandoverOrigin = 'manual' | 'request_accepted' | 'one_off_change';

/** Fila `handovers` tal cual en la base de datos. */
export interface HandoverRow {
  id: number;
  date: string;
  effective_priority_user_id: number;
  origin: HandoverOrigin;
  request_id: number | null;
  created_at: string;
}

/** DTO de handover para la API (camelCase). */
export interface HandoverDto {
  date: string;
  effectivePriorityUserId: number;
  origin: HandoverOrigin;
  requestId: number | null;
  createdAt: string;
}
