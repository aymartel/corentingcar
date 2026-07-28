// Fija DATABASE_PATH=:memory: antes de cargar la conexión (debe ir primero).
import '../test/use-memory-db.js';

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './connection.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { ensureDatabaseReady } from './bootstrap.js';
import { getPlanForMonth, getScheduledPlan } from '../services/mileage-plans.service.js';

/**
 * Red de seguridad contra la trampa histórica de `reconcileRules`: era un UPDATE incondicional
 * en CADA arranque, así que cualquier ajuste del usuario se revertía al re-desplegar. Ahora los
 * cambios viven en `mileage_plans` y la línea base de `rules` es propiedad del código: arrancar
 * el servidor N veces no puede tocar un plan programado.
 */

const BASELINE = { annualKmTotal: 15000, monthlyFeeEur: 355 };

beforeEach(() => {
  db.pragma('foreign_keys = OFF');
  for (const table of ['mileage_plans', 'usage_logs', 'rules', 'users']) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
});

describe('arranque idempotente con planes de kilometraje', () => {
  it('ensureDatabaseReady dos veces NO revierte un plan programado', () => {
    db.prepare(
      `INSERT INTO mileage_plans (effective_month, annual_km_total, monthly_fee_eur, created_by_user_id)
       VALUES ('2026-08', 25000, 425, 1)`,
    ).run();

    ensureDatabaseReady(db);
    ensureDatabaseReady(db);

    const rows = db.prepare('SELECT * FROM mileage_plans').all();
    expect(rows).toHaveLength(1);

    // El plan de agosto sigue vigente en agosto (no ha vuelto a 15.000).
    expect(getPlanForMonth('2026-08', BASELINE).annualKmTotal).toBe(25000);
    expect(getPlanForMonth('2026-08', BASELINE).monthlyFeeEur).toBe(425);
    // Y julio conserva la línea base: el pasado no se reescribe.
    expect(getPlanForMonth('2026-07', BASELINE).annualKmTotal).toBe(15000);
  });

  it('la tabla arranca vacía y el cupo resuelto es idéntico al de antes de la feature', () => {
    ensureDatabaseReady(db);

    expect(db.prepare('SELECT COUNT(*) AS n FROM mileage_plans').get()).toEqual({ n: 0 });
    // 15.000 / 24 = 625 = el Math.round(7500 / 12) que se usaba antes: despliegue no-op.
    expect(getPlanForMonth('2026-07', BASELINE).annualKmTotal / 24).toBe(625);
    expect(getScheduledPlan('2026-07')).toBeNull();
  });

  it('reconcileBaselinePlan repone la línea base pero no crea planes', () => {
    db.prepare('UPDATE rules SET annual_km_total = 99999, monthly_fee_eur = 1 WHERE id = 1').run();

    ensureDatabaseReady(db);

    const rules = db.prepare('SELECT * FROM rules WHERE id = 1').get() as {
      annual_km_total: number;
      annual_km_per_person: number;
      monthly_fee_eur: number;
    };
    expect(rules.annual_km_total).toBe(15000);
    expect(rules.annual_km_per_person).toBe(7500);
    expect(rules.monthly_fee_eur).toBe(355);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mileage_plans').get()).toEqual({ n: 0 });
  });
});
