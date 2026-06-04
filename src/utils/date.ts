/**
 * Utilidades de fecha. Las fechas del dominio son civiles (`YYYY-MM-DD`). El número de día
 * se calcula con `Date.UTC` (días UTC de 86.400.000 ms exactos), por lo que es **inmune a
 * DST**: la diferencia entre dos fechas civiles no depende de la zona horaria ni del cambio
 * de hora. La zona horaria solo se usa para saber qué fecha es "hoy".
 */
const MS_PER_DAY = 86_400_000;

/** Número de día absoluto de una fecha `YYYY-MM-DD` (para diferencias exactas en días). */
export function dayNumberFromIso(iso: string): number {
  const [y, m, d] = iso.split('-');
  return Math.round(Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY);
}

/** ¿Es `YYYY-MM-DD` una fecha de calendario real (sin desbordes como 2025-02-30)? */
export function isValidIsoDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Fecha de "hoy" (`YYYY-MM-DD`) en la zona horaria indicada (p.ej. Europe/Madrid). */
export function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Número de días del mes (`month1` es 1..12). */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Lista de fechas `YYYY-MM-DD` de un mes `YYYY-MM`. */
export function enumerateMonthDays(month: string): string[] {
  const [ys, ms] = month.split('-');
  const year = Number(ys);
  const month1 = Number(ms);
  const total = daysInMonth(year, month1);
  const days: string[] = [];
  for (let d = 1; d <= total; d += 1) {
    days.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return days;
}
