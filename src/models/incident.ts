import type { EntryType } from './entry-type.js';
import type { UserDto } from './user.js';

/**
 * Incidencia del coche: multa, golpe, avería o cualquier otra cosa que haya que tener en cuenta
 * al devolverlo. Nace ABIERTA y puede no tener importe todavía; su coste solo entra en el saldo
 * al marcarla RESUELTA (resolver = ya se pagó o ya se reparó).
 */
export type IncidentKind = 'fine' | 'damage' | 'breakdown' | 'other';
export type IncidentStatus = 'open' | 'resolved';

export const INCIDENT_KINDS: readonly IncidentKind[] = ['fine', 'damage', 'breakdown', 'other'];
export const INCIDENT_STATUSES: readonly IncidentStatus[] = ['open', 'resolved'];

/** Fila `incidents` tal cual en la base de datos (snake_case). Importes en €. */
export interface IncidentRow {
  id: number;
  reported_by: number;
  date: string;
  kind: IncidentKind;
  description: string;
  /** Coste previsto (si está abierta) o final (si está resuelta). `null` mientras no se sabe. */
  amount_eur: number | null;
  type: EntryType;
  /** Quién ASUME el coste cuando `type = 'individual'`. `null` si es compartida. */
  responsible_user_id: number | null;
  status: IncidentStatus;
  /** Quién PUSO el dinero. Solo se rellena al resolver. */
  paid_by: number | null;
  resolved_at: string | null;
  created_at: string;
}

/** DTO de incidencia para la API (camelCase). */
export interface IncidentDto {
  id: number;
  date: string;
  kind: IncidentKind;
  description: string;
  amountEur: number | null;
  type: EntryType;
  status: IncidentStatus;
  resolvedAt: string | null;
  createdAt: string;
}

/** DTO enriquecido con las personas resueltas (patrón de `SettlementEntryDto`). */
export interface IncidentEntryDto extends IncidentDto {
  reportedBy: UserDto;
  responsible: UserDto | null;
  paidBy: UserDto | null;
}
