import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getRules } from './rules.service.js';
import { listUsers } from './users.service.js';
import { computeBalance, nextWashUserId, round2 } from './expenses.core.js';
import { computeFuelSplit } from './fuel-split.service.js';
import type { EntryType } from '../models/entry-type.js';
import type { FuelRow, FuelDto, FuelSplitDto } from '../models/fuel.js';
import type { WashRow, WashDto } from '../models/wash.js';
import type { OtherExpenseRow, OtherExpenseDto } from '../models/other-expense.js';
import type { UserDto } from '../models/user.js';

/**
 * Construye el desglose del reparto por km de una fila de gasolina a partir de las columnas
 * persistidas. Devuelve `null` en filas antiguas (sin reparto guardado) → la app cae a `type`.
 */
function buildFuelSplit(row: FuelRow, usersByProfile: Map<string, UserDto>): FuelSplitDto | null {
  if (row.split_method == null || row.payer_share_eur == null) return null;
  const user1 = usersByProfile.get('user1');
  const user2 = usersByProfile.get('user2');
  if (!user1 || !user2) return null;
  const payerShareEur = round2(row.payer_share_eur);
  const otherShareEur = round2(row.amount_eur - payerShareEur);
  return {
    method: row.split_method,
    payerShareEur,
    perUser: [
      {
        userId: user1.id,
        km: row.km_user1 ?? 0,
        shareEur: user1.id === row.user_id ? payerShareEur : otherShareEur,
      },
      {
        userId: user2.id,
        km: row.km_user2 ?? 0,
        shareEur: user2.id === row.user_id ? payerShareEur : otherShareEur,
      },
    ],
  };
}

function toFuelDto(row: FuelRow, usersByProfile: Map<string, UserDto>): FuelDto {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    amountEur: round2(row.amount_eur),
    type: row.type,
    odometerKm: row.odometer_km,
    split: buildFuelSplit(row, usersByProfile),
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

/**
 * Registra un repostaje asociado a quien repostó/pagó. Siempre `shared`: el importe se reparte
 * proporcional a los km que hizo cada persona desde el repostaje anterior, según el ODÓMETRO del
 * cuadro al repostar (`odometerKm`); 50/50 si no hubo km en el tramo. El reparto se calcula y se
 * PERSISTE como snapshot (inmutable frente a ediciones posteriores de los usos).
 */
export function createFuel(
  userId: number,
  input: { date: string; amountEur: number; odometerKm: number },
): FuelDto {
  const split = computeFuelSplit(userId, input.odometerKm, input.amountEur);
  const usersByProfile = new Map(listUsers().map((u) => [u.profile, u]));
  const kmUser1 = split.perUser.find((p) => p.user.profile === 'user1')?.km ?? null;
  const kmUser2 = split.perUser.find((p) => p.user.profile === 'user2')?.km ?? null;

  const result = db
    .prepare(
      `INSERT INTO fuel_logs
         (user_id, date, amount_eur, type, split_method, payer_share_eur, odometer_km, km_user1, km_user2)
       VALUES (@userId, @date, @amountEur, 'shared', @splitMethod, @payerShareEur, @odometerKm, @kmUser1, @kmUser2)`,
    )
    .run({
      userId,
      date: input.date,
      amountEur: round2(input.amountEur),
      splitMethod: split.fallback ? 'fallback_5050' : 'km',
      payerShareEur: split.payerShareEur,
      odometerKm: input.odometerKm,
      kmUser1,
      kmUser2,
    });
  const row = db.prepare('SELECT * FROM fuel_logs WHERE id = ?').get(result.lastInsertRowid) as FuelRow;
  return toFuelDto(row, usersByProfile);
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
  const usersByProfile = new Map(users.map((u) => [u.profile, u]));

  const totalsWithUser = (raw: { userId: number; totalEur: number }[]): { user: UserDto; totalEur: number }[] =>
    raw.map((t) => ({ user: requireUser(usersById, t.userId), totalEur: t.totalEur }));

  // --- Gasolina ---
  const fuelRows = db.prepare('SELECT * FROM fuel_logs ORDER BY date DESC, id DESC').all() as FuelRow[];
  const fuelList: FuelEntryDto[] = fuelRows.map((row) => ({
    ...toFuelDto(row, usersByProfile),
    user: requireUser(usersById, row.user_id),
  }));
  // `payerShareEur` (reparto por km) sobreescribe el 50/50 del `type`; NULL en filas antiguas → legacy.
  const fuelEntries = fuelRows.map((r) => ({
    userId: r.user_id,
    amountEur: r.amount_eur,
    type: r.type,
    payerShareEur: r.payer_share_eur ?? undefined,
  }));
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
