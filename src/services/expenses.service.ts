import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getRules } from './rules.service.js';
import { listUsers } from './users.service.js';
import { computeBalance, nextWashUserId, round2 } from './expenses.core.js';
import type { EntryType } from '../models/entry-type.js';
import type { FuelRow, FuelDto, FuelType } from '../models/fuel.js';
import type { WashRow, WashDto } from '../models/wash.js';
import type { OtherExpenseRow, OtherExpenseDto } from '../models/other-expense.js';
import type { UserDto } from '../models/user.js';

function toFuelDto(row: FuelRow): FuelDto {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    amountEur: round2(row.amount_eur),
    type: row.type,
    createdAt: row.created_at,
  };
}

function toOtherExpenseDto(row: OtherExpenseRow): OtherExpenseDto {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    amountEur: round2(row.amount_eur),
    type: row.type,
    description: row.description,
    createdAt: row.created_at,
  };
}

function toWashDto(row: WashRow): WashDto {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    costEur: row.cost_eur == null ? null : round2(row.cost_eur),
    createdAt: row.created_at,
  };
}

function requireUser(usersById: Map<number, UserDto>, id: number): UserDto {
  const user = usersById.get(id);
  if (!user) throw new AppError('NOT_FOUND', `Usuario ${id} no encontrado.`, 404);
  return user;
}

/** Registra un repostaje asociado a quien repostó/pagó. */
export function createFuel(
  userId: number,
  input: { date: string; amountEur: number; type: FuelType },
): FuelDto {
  const result = db
    .prepare(
      `INSERT INTO fuel_logs (user_id, date, amount_eur, type)
       VALUES (@userId, @date, @amountEur, @type)`,
    )
    .run({ userId, date: input.date, amountEur: round2(input.amountEur), type: input.type });
  const row = db.prepare('SELECT * FROM fuel_logs WHERE id = ?').get(result.lastInsertRowid) as FuelRow;
  return toFuelDto(row);
}

/** Registra un lavado asociado a quien lavó/pagó (coste opcional). */
export function createWash(
  userId: number,
  input: { date: string; costEur?: number },
): WashDto {
  const result = db
    .prepare(`INSERT INTO wash_logs (user_id, date, cost_eur) VALUES (@userId, @date, @costEur)`)
    .run({ userId, date: input.date, costEur: input.costEur == null ? null : round2(input.costEur) });
  const row = db.prepare('SELECT * FROM wash_logs WHERE id = ?').get(result.lastInsertRowid) as WashRow;
  return toWashDto(row);
}

/** Registra un "otro gasto" (peaje, líquido, etc.) asociado a quien lo pagó. */
export function createOtherExpense(
  userId: number,
  input: { date: string; amountEur: number; type: EntryType; description: string },
): OtherExpenseDto {
  const result = db
    .prepare(
      `INSERT INTO other_expense_logs (user_id, date, amount_eur, type, description)
       VALUES (@userId, @date, @amountEur, @type, @description)`,
    )
    .run({
      userId,
      date: input.date,
      amountEur: round2(input.amountEur),
      type: input.type,
      description: input.description,
    });
  const row = db
    .prepare('SELECT * FROM other_expense_logs WHERE id = ?')
    .get(result.lastInsertRowid) as OtherExpenseRow;
  return toOtherExpenseDto(row);
}

type FuelEntryDto = FuelDto & { user: UserDto };
type WashEntryDto = WashDto & { user: UserDto };
type OtherExpenseEntryDto = OtherExpenseDto & { user: UserDto };
type BalanceDto = { settled: boolean; fromUser: UserDto | null; toUser: UserDto | null; amountEur: number };

export interface ExpensesSummary {
  fuel: {
    list: FuelEntryDto[];
    totalPerUser: { user: UserDto; totalEur: number }[];
    /** @deprecated Alias del `balance` combinado top-level (gasolina + otros). Para clientes antiguos. */
    balance: BalanceDto;
  };
  other: {
    list: OtherExpenseEntryDto[];
    totalPerUser: { user: UserDto; totalEur: number }[];
  };
  /** Saldo combinado (gasolina + otros) entre los 2 usuarios. */
  balance: BalanceDto;
  wash: {
    last: WashEntryDto | null;
    nextWashUser: UserDto;
    history: WashEntryDto[];
  };
}

/** Resumen de gastos: balance combinado (gasolina + otros) + último/próximo lavado + historiales. */
export function getExpenses(): ExpensesSummary {
  const rules = getRules();
  const users = listUsers();
  const userA = users[0];
  const userB = users[1];
  if (!userA || !userB) {
    throw new AppError('NOT_FOUND', 'Faltan usuarios sembrados.', 500);
  }
  const usersById = new Map(users.map((u) => [u.id, u]));

  const totalsWithUser = (raw: { userId: number; totalEur: number }[]): { user: UserDto; totalEur: number }[] =>
    raw.map((t) => ({ user: requireUser(usersById, t.userId), totalEur: t.totalEur }));

  // --- Gasolina ---
  const fuelRows = db.prepare('SELECT * FROM fuel_logs ORDER BY date DESC, id DESC').all() as FuelRow[];
  const fuelList: FuelEntryDto[] = fuelRows.map((row) => ({
    ...toFuelDto(row),
    user: requireUser(usersById, row.user_id),
  }));
  const fuelEntries = fuelRows.map((r) => ({ userId: r.user_id, amountEur: r.amount_eur, type: r.type }));
  const fuelTotalPerUser = totalsWithUser(computeBalance(fuelEntries, userA.id, userB.id).totalPerUser);

  // --- Otros gastos ---
  const otherRows = db
    .prepare('SELECT * FROM other_expense_logs ORDER BY date DESC, id DESC')
    .all() as OtherExpenseRow[];
  const otherList: OtherExpenseEntryDto[] = otherRows.map((row) => ({
    ...toOtherExpenseDto(row),
    user: requireUser(usersById, row.user_id),
  }));
  const otherEntries = otherRows.map((r) => ({ userId: r.user_id, amountEur: r.amount_eur, type: r.type }));
  const otherTotalPerUser = totalsWithUser(computeBalance(otherEntries, userA.id, userB.id).totalPerUser);

  // --- Saldo combinado (gasolina + otros) ---
  const balanceRaw = computeBalance([...fuelEntries, ...otherEntries], userA.id, userB.id);
  const balance: BalanceDto = {
    settled: balanceRaw.settled,
    amountEur: balanceRaw.amountEur,
    fromUser: balanceRaw.fromUserId != null ? requireUser(usersById, balanceRaw.fromUserId) : null,
    toUser: balanceRaw.toUserId != null ? requireUser(usersById, balanceRaw.toUserId) : null,
  };

  // --- Lavado ---
  const washRows = db
    .prepare('SELECT * FROM wash_logs ORDER BY date DESC, created_at DESC, id DESC')
    .all() as WashRow[];
  const history: WashEntryDto[] = washRows.map((row) => ({
    ...toWashDto(row),
    user: requireUser(usersById, row.user_id),
  }));
  const lastRow = washRows[0] ?? null;
  const last: WashEntryDto | null = lastRow
    ? { ...toWashDto(lastRow), user: requireUser(usersById, lastRow.user_id) }
    : null;
  const nextUserId = nextWashUserId(
    lastRow ? lastRow.user_id : null,
    userA.id,
    userB.id,
    rules.firstWashUserId,
  );

  return {
    // `fuel.balance` se mantiene como alias del balance combinado para clientes antiguos (ver interface).
    fuel: { list: fuelList, totalPerUser: fuelTotalPerUser, balance },
    other: { list: otherList, totalPerUser: otherTotalPerUser },
    balance,
    wash: { last, nextWashUser: requireUser(usersById, nextUserId), history },
  };
}
