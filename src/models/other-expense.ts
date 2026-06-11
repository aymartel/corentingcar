import type { EntryType } from './entry-type.js';

/** Fila `other_expense_logs` tal cual en la base de datos. Importes en €. */
export interface OtherExpenseRow {
  id: number;
  user_id: number;
  date: string;
  amount_eur: number;
  type: EntryType;
  description: string;
  created_at: string;
}

/** DTO de otro gasto para la API (camelCase). Importes en €. */
export interface OtherExpenseDto {
  id: number;
  userId: number;
  date: string;
  amountEur: number;
  type: EntryType;
  description: string;
  createdAt: string;
}
