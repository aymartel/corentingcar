import { db } from '../db/connection.js';
import { getRules } from './rules.service.js';
import { todayInTimezone } from '../utils/date.js';

/**
 * Contraseña de administrador para acciones destructivas. Hardcodeada por defecto
 * (`Pass4admin`), sobreescribible por entorno `ADMIN_PASSWORD`.
 */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Pass4admin';

export function isAdminPassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

export interface ResetResult {
  clearedTables: string[];
  initialKm: number;
  baselineDate: string;
}

/**
 * Borra TODOS los datos transaccionales (cesiones, solicitudes, usos, gasolina, lavados, otros
 * gastos) y registra un uso base de 0 km con el odómetro inicial `initialKm` (el coche se recibe
 * con esa lectura). Conserva usuarios, reglas y la sesión actual. El registro base ancla el
 * odómetro: el primer uso real deberá partir de `initialKm` o más.
 */
export function resetAllData(userId: number, initialKm: number): ResetResult {
  const rules = getRules();
  const today = todayInTimezone(rules.timezone);
  const clearedTables = [
    'handovers',
    'requests',
    'usage_logs',
    'fuel_logs',
    'wash_logs',
    'other_expense_logs',
    'settlements',
    'incidents',
  ];

  const run = db.transaction(() => {
    // Orden respetando claves foráneas: handovers -> requests antes que el resto.
    db.prepare('DELETE FROM handovers').run();
    db.prepare('DELETE FROM requests').run();
    db.prepare('DELETE FROM usage_logs').run();
    db.prepare('DELETE FROM fuel_logs').run();
    db.prepare('DELETE FROM wash_logs').run();
    db.prepare('DELETE FROM other_expense_logs').run();
    db.prepare('DELETE FROM settlements').run();
    db.prepare('DELETE FROM incidents').run();

    // Línea base del odómetro: coche recibido a `initialKm` (uso de 0 km).
    db.prepare(
      `INSERT INTO usage_logs (user_id, date, start_km, end_km, total_km, type)
       VALUES (?, ?, ?, ?, 0, 'individual')`,
    ).run(userId, today, initialKm, initialKm);
  });
  run();

  return { clearedTables, initialKm, baselineDate: today };
}
