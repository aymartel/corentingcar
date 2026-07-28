import { describe, it, expect } from 'vitest';
import {
  roundTo,
  sharedPerPerson,
  personMileage,
  recommendedAllowanceToDate,
  recommendedAllowanceToDateByMonth,
  yearAllowancePerPerson,
  monthlyPerPersonFromAnnual,
  type MonthlyAllowanceLookup,
} from './mileage.core.js';
import { monthOfIso, nextMonth } from '../utils/date.js';

const LIMIT = 7500;

/** Plan de 15.000 hasta julio de 2026 y de 25.000 desde agosto (el caso real del usuario). */
const upgradeInAugust: MonthlyAllowanceLookup = (year, month1) =>
  monthlyPerPersonFromAnnual(year > 2026 || (year === 2026 && month1 >= 8) ? 25000 : 15000);

describe('sharedPerPerson (reparto 50/50)', () => {
  it('reparte los km compartidos a la mitad', () => {
    expect(sharedPerPerson(100, 1)).toBe(50);
    expect(sharedPerPerson(0, 1)).toBe(0);
  });
  it('respeta el redondeo configurado', () => {
    expect(sharedPerPerson(101, 1)).toBe(50.5);
    expect(sharedPerPerson(101, 0)).toBe(51); // 50.5 -> 51 con 0 decimales
  });
});

describe('personMileage', () => {
  it('individual 100 + compartido 100 → esa persona usa 150', () => {
    // 100 individual + (100/2)=50 de compartido
    expect(personMileage(100, 50, LIMIT)).toEqual({
      usedKm: 150,
      remainingKm: 7350,
      exceeded: false,
      excessKm: 0,
    });
  });

  it('marca exceso al superar el cupo anual', () => {
    const r = personMileage(7500, 100, LIMIT); // 7600 usados
    expect(r.usedKm).toBe(7600);
    expect(r.exceeded).toBe(true);
    expect(r.excessKm).toBe(100);
    expect(r.remainingKm).toBe(-100);
  });

  it('justo en el límite no marca exceso', () => {
    const r = personMileage(7500, 0, LIMIT);
    expect(r.exceeded).toBe(false);
    expect(r.excessKm).toBe(0);
    expect(r.remainingKm).toBe(0);
  });
});

describe('recommendedAllowanceToDate (cupo acumulado, 625/mes)', () => {
  it('mismo día de inicio → 1 día prorrateado del mes', () => {
    // 625 * (1/30) = 20.83 → 20.8
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-10', 625)).toBe(20.8);
  });

  it('parte del mes de inicio (10→30 jun = 21 días de 30)', () => {
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-30', 625)).toBe(437.5);
  });

  it('acumula meses: 10 jun → 31 jul = parte de junio + julio entero', () => {
    // 437.5 (junio 21/30) + 625 (julio entero) = 1062.5
    expect(recommendedAllowanceToDate('2026-06-10', '2026-07-31', 625)).toBe(1062.5);
  });

  it('fecha anterior al inicio → 0', () => {
    expect(recommendedAllowanceToDate('2026-06-10', '2026-06-09', 625)).toBe(0);
  });
});

describe('monthlyPerPersonFromAnnual (el escalón es ANUAL)', () => {
  it('divide entre 12 meses y entre 2 personas, sin redondear', () => {
    expect(monthlyPerPersonFromAnnual(15000)).toBe(625);
    expect(monthlyPerPersonFromAnnual(25000)).toBeCloseTo(1041.6667, 4);
    // El número que enseña el renting es el mensual de los dos: 25.000 / 12 = 2.083.
    expect(Math.round(25000 / 12)).toBe(2083);
  });

  it('no redondea en medio: 12 meses suman exactamente la mitad del anual', () => {
    expect(monthlyPerPersonFromAnnual(25000) * 12).toBeCloseTo(12500, 6);
    // Con el 2.083 ya redondeado dividido entre dos (1.041,5) faltarían 2 km al año.
    expect(Math.round(25000 / 12) / 2).toBe(1041.5);
    expect(1041.5 * 12).toBe(12498);
  });
});

describe('recommendedAllowanceToDateByMonth (cupo variable por mes)', () => {
  it('con cupo constante coincide con la versión de un solo valor', () => {
    expect(recommendedAllowanceToDateByMonth('2026-06-10', '2026-07-31', () => 625)).toBe(
      recommendedAllowanceToDate('2026-06-10', '2026-07-31', 625),
    );
  });

  it('julio usa el plan viejo y agosto el nuevo (el cambio cae en día 1, nunca parte un mes)', () => {
    // Julio entero a 625 + agosto entero a 1041,67 = 1666,67 → 1666,7
    expect(recommendedAllowanceToDateByMonth('2026-07-01', '2026-08-31', upgradeInAugust)).toBe(
      1666.7,
    );
    // Solo julio: el plan de agosto no lo toca.
    expect(recommendedAllowanceToDateByMonth('2026-07-01', '2026-07-31', upgradeInAugust)).toBe(625);
  });
});

describe('yearAllowancePerPerson (cupo del año natural)', () => {
  it('año completo con un solo plan', () => {
    expect(yearAllowancePerPerson(2026, () => monthlyPerPersonFromAnnual(15000))).toBe(7500);
    expect(yearAllowancePerPerson(2026, () => monthlyPerPersonFromAnnual(20000))).toBe(10000);
    expect(yearAllowancePerPerson(2026, () => monthlyPerPersonFromAnnual(25000))).toBe(12500);
  });

  it('año mixto: 7 meses a 15.000 + 5 a 25.000 → 9.583 por persona', () => {
    // 7 × 625 + 5 × 1041,6667 = 4375 + 5208,33 = 9583,33
    expect(yearAllowancePerPerson(2026, upgradeInAugust)).toBe(9583);
    // El año siguiente ya es 25.000 completo.
    expect(yearAllowancePerPerson(2027, upgradeInAugust)).toBe(12500);
  });

  it('el total del año se deriva como 2× el de por persona (barras coherentes)', () => {
    for (const lookup of [
      () => monthlyPerPersonFromAnnual(15000),
      () => monthlyPerPersonFromAnnual(25000),
      upgradeInAugust,
    ]) {
      const perPerson = yearAllowancePerPerson(2026, lookup);
      expect(perPerson * 2).toBe(perPerson + perPerson);
    }
  });
});

describe('helpers de mes', () => {
  it('monthOfIso extrae YYYY-MM', () => {
    expect(monthOfIso('2026-07-28')).toBe('2026-07');
  });

  it('nextMonth rueda diciembre a enero del año siguiente', () => {
    expect(nextMonth('2026-07')).toBe('2026-08');
    expect(nextMonth('2026-09')).toBe('2026-10');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('los meses se comparan como texto sin sorpresas (siempre con dos dígitos)', () => {
    expect(nextMonth('2026-08') < nextMonth('2026-09')).toBe(true);
    expect('2026-09' < '2026-10').toBe(true);
  });
});

describe('roundTo', () => {
  it('redondea sin ruido de coma flotante', () => {
    expect(roundTo(0.1 + 0.2, 1)).toBe(0.3);
    expect(roundTo(50.55, 1)).toBe(50.6);
  });
});
