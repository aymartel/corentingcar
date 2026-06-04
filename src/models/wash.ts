/** Fila `wash_logs` tal cual en la base de datos. `cost_eur` opcional. */
export interface WashRow {
  id: number;
  user_id: number;
  date: string;
  cost_eur: number | null;
  created_at: string;
}

/** DTO de lavado para la API (camelCase). */
export interface WashDto {
  id: number;
  userId: number;
  date: string;
  costEur: number | null;
  createdAt: string;
}
