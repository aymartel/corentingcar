/** Tipo de uso: individual (a una persona) o shared (viaje compartido, 50/50). */
export type UsageType = 'individual' | 'shared';

/** Fila `usage_logs` tal cual en la base de datos. Distancias en km. */
export interface UsageRow {
  id: number;
  user_id: number;
  date: string;
  start_km: number;
  end_km: number;
  total_km: number;
  type: UsageType;
  created_at: string;
}

/** DTO de registro de uso para la API (camelCase). Distancias en km. */
export interface UsageDto {
  id: number;
  userId: number;
  date: string;
  startKm: number;
  endKm: number;
  totalKm: number;
  type: UsageType;
  createdAt: string;
}
