/**
 * Tipo de reparto de un gasto compartible entre los 2 usuarios:
 *  - `individual`: lo asume entero quien lo pagó.
 *  - `shared`: se divide 50/50 (el otro debe la mitad a quien pagó).
 *
 * Lo comparten gasolina (`fuel_logs`) y otros gastos (`other_expense_logs`); el
 * cálculo del saldo (ver `expenses.core.ts`) es agnóstico a la fuente.
 */
export type EntryType = 'individual' | 'shared';
