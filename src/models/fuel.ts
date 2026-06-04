/** Tipo de repostaje: individual (lo paga quien consume) o shared (viaje compartido, 50/50). */
export type FuelType = 'individual' | 'shared';

/** Fila `fuel_logs` tal cual en la base de datos. Importes en €. */
export interface FuelRow {
  id: number;
  user_id: number;
  date: string;
  amount_eur: number;
  type: FuelType;
  created_at: string;
}

/** DTO de repostaje para la API (camelCase). Importes en €. */
export interface FuelDto {
  id: number;
  userId: number;
  date: string;
  amountEur: number;
  type: FuelType;
  createdAt: string;
}
