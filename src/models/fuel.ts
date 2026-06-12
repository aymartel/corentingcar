import type { EntryType } from './entry-type.js';

/** Tipo de repostaje: individual (lo paga quien consume) o shared (viaje compartido, 50/50). */
export type FuelType = EntryType;

/** Método de reparto de un repostaje. */
export type FuelSplitMethod = 'km' | 'fallback_5050';

/** Fila `fuel_logs` tal cual en la base de datos. Importes en €. */
export interface FuelRow {
  id: number;
  user_id: number;
  date: string;
  amount_eur: number;
  type: FuelType;
  /** Reparto por km (NULL en filas antiguas → saldo por `type`). */
  split_method: FuelSplitMethod | null;
  payer_share_eur: number | null;
  /** Km del cuadro al repostar; define la ventana del reparto (NULL en filas antiguas). */
  odometer_km: number | null;
  km_user1: number | null;
  km_user2: number | null;
  created_at: string;
}

/** Desglose del reparto por km de un repostaje (para mostrar en historial). */
export interface FuelSplitDto {
  method: FuelSplitMethod;
  /** Parte (€) que asume quien pagó (`userId`). */
  payerShareEur: number;
  /** Reparto por usuario: km del periodo y € que asume cada uno. */
  perUser: { userId: number; km: number; shareEur: number }[];
}

/** DTO de repostaje para la API (camelCase). Importes en €. */
export interface FuelDto {
  id: number;
  userId: number;
  date: string;
  amountEur: number;
  type: FuelType;
  /** Km del cuadro al repostar; `null` en repostajes antiguos. */
  odometerKm: number | null;
  /** Reparto por km; `null` en filas antiguas (compatibilidad: la app cae a `type`). */
  split: FuelSplitDto | null;
  createdAt: string;
}
