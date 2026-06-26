/** Fila `settlements` tal cual en la base de datos. Importes en €. */
export interface SettlementRow {
  id: number;
  from_user_id: number;
  to_user_id: number;
  date: string;
  amount_eur: number;
  note: string | null;
  created_at: string;
}

/** DTO de pago directo entre usuarios para la API (camelCase). Importes en €. */
export interface SettlementDto {
  id: number;
  fromUserId: number;
  toUserId: number;
  date: string;
  amountEur: number;
  note: string | null;
  createdAt: string;
}
