import { dayNumberFromIso } from '../utils/date.js';

export type PrioritySource = 'rotation' | 'handover';

/**
 * PURE — Usuario con prioridad por **alternancia diaria continua** desde la fecha ancla.
 * Depende solo de la **paridad** de la distancia en días a la fecha ancla, por lo que:
 *  - es continua (no se reinicia por semana ni por mes),
 *  - es simétrica hacia el pasado,
 *  - es inmune a DST (usa días UTC; ver utils/date).
 */
export function rotationUserId(
  anchorDate: string,
  anchorUserId: number,
  otherUserId: number,
  date: string,
): number {
  const diffDays = dayNumberFromIso(date) - dayNumberFromIso(anchorDate);
  return diffDays % 2 === 0 ? anchorUserId : otherUserId;
}

/**
 * PURE — Prioridad EFECTIVA de un día: si hay override (handover) manda; si no, la alternancia.
 */
export function resolvePriority(params: {
  date: string;
  anchorDate: string;
  anchorUserId: number;
  otherUserId: number;
  handoverUserId?: number | null;
}): { userId: number; source: PrioritySource } {
  if (params.handoverUserId != null) {
    return { userId: params.handoverUserId, source: 'handover' };
  }
  return {
    userId: rotationUserId(params.anchorDate, params.anchorUserId, params.otherUserId, params.date),
    source: 'rotation',
  };
}

/**
 * Frase de conflicto (español) para la pantalla HOY. El día solo da PRIORIDAD en conflicto;
 * no obliga a usar el coche.
 */
export function conflictPhrase(priorityUserName: string): string {
  return `Hoy tiene prioridad ${priorityUserName}. Si ambos necesitáis el coche hoy, decide ${priorityUserName}.`;
}
