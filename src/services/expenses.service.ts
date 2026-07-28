import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getRules } from './rules.service.js';
import { listUsers } from './users.service.js';
import { computeBalance, nextWash, round2 } from './expenses.core.js';
import { computeFuelSplit } from './fuel-split.service.js';
import { listIncidentRows, listIncidents } from './incidents.service.js';
import type { IncidentEntryDto } from '../models/incident.js';
import type { EntryType } from '../models/entry-type.js';
import type { FuelRow, FuelDto, FuelSplitDto } from '../models/fuel.js';
import type { WashRow, WashDto } from '../models/wash.js';
import type { OtherExpenseRow, OtherExpenseDto } from '../models/other-expense.js';
import type { SettlementRow, SettlementDto } from '../models/settlement.js';
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

function toSettlementDto(row: SettlementRow): SettlementDto {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    date: row.date,
    amountEur: round2(row.amount_eur),
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Registra un pago directo de `fromUserId` a `toUserId` (saldar cuentas), sin vincularlo a un gasto.
 * Ajusta el saldo combinado: reduce lo que el pagador debe al receptor (o lo invierte si paga de más).
 */
export function createSettlement(input: {
  fromUserId: number;
  toUserId: number;
  date: string;
  amountEur: number;
  note?: string | null;
}): SettlementDto {
  if (input.fromUserId === input.toUserId) {
    throw new AppError('VALIDATION_ERROR', 'El pagador y el receptor deben ser distintos.', 400);
  }
  const users = new Set(listUsers().map((u) => u.id));
  if (!users.has(input.fromUserId) || !users.has(input.toUserId)) {
    throw new AppError('NOT_FOUND', 'Usuario no encontrado.', 404);
  }
  const result = db
    .prepare(
      `INSERT INTO settlements (from_user_id, to_user_id, date, amount_eur, note)
       VALUES (@fromUserId, @toUserId, @date, @amountEur, @note)`,
    )
    .run({
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      date: input.date,
      amountEur: round2(input.amountEur),
      note: input.note?.trim() ? input.note.trim() : null,
    });
  const row = db.prepare('SELECT * FROM settlements WHERE id = ?').get(result.lastInsertRowid) as SettlementRow;
  return toSettlementDto(row);
}

/** Elimina un pago directo (deshacer). Lanza 404 si no existe. */
export function deleteSettlement(id: number): void {
  const result = db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new AppError('NOT_FOUND', 'Pago no encontrado.', 404);
  }
}

type FuelEntryDto = FuelDto & { user: UserDto };
type WashEntryDto = WashDto & { user: UserDto };
type OtherExpenseEntryDto = OtherExpenseDto & { user: UserDto };
type SettlementEntryDto = SettlementDto & { fromUser: UserDto; toUser: UserDto };
type BalanceDto = { settled: boolean; fromUser: UserDto | null; toUser: UserDto | null; amountEur: number };

export interface ExpensesSummary {
  fuel: {
    list: FuelEntryDto[];
    totalPerUser: { user: UserDto; totalEur: number }[];
    /** @deprecated Alias del `balance` combinado top-level (gasolina + otros + lavados + incidencias − pagos). Para clientes antiguos. */
    balance: BalanceDto;
  };
  other: {
    list: OtherExpenseEntryDto[];
    totalPerUser: { user: UserDto; totalEur: number }[];
  };
  /** Incidencias del coche (multas, golpes, averías): importan al final del contrato. */
  incidents: {
    list: IncidentEntryDto[];
    /** Cuántas siguen ABIERTAS (lo que hay que revisar antes de devolver el coche). */
    openCount: number;
    /** Coste previsto de las abiertas. Aún NO está en el saldo. */
    pendingAmountEur: number;
    /** Lo desembolsado por cada uno en incidencias ya resueltas. */
    totalPerUser: { user: UserDto; totalEur: number }[];
  };
  /** Pagos directos entre los 2 usuarios (saldar cuentas), que ajustan el balance. */
  settlements: {
    list: SettlementEntryDto[];
  };
  /** Saldo combinado (gasolina + otros + lavados + incidencias resueltas − pagos) entre los 2 usuarios. */
  balance: BalanceDto;
  wash: {
    last: WashEntryDto | null;
    nextWashUser: UserDto;
    /** Veces SEGUIDAS que le tocan al próximo (>1 si va por detrás porque el otro lavó de más). */
    owedWashes: number;
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

  // --- Pagos directos (saldar cuentas) ---
  const settlementRows = db
    .prepare('SELECT * FROM settlements ORDER BY date DESC, id DESC')
    .all() as SettlementRow[];
  const settlementList: SettlementEntryDto[] = settlementRows.map((row) => ({
    ...toSettlementDto(row),
    fromUser: requireUser(usersById, row.from_user_id),
    toUser: requireUser(usersById, row.to_user_id),
  }));
  // Un pago de F→T = el pagador asume 0 y el otro asume todo → reduce la deuda de F con T.
  const settlementEntries = settlementRows.map((r) => ({
    userId: r.from_user_id,
    amountEur: r.amount_eur,
    type: 'shared' as EntryType,
    payerShareEur: 0,
  }));

  // --- Lavado: el coste (si se registró) cuenta como gasto COMPARTIDO en el saldo ---
  const washRows = db
    .prepare('SELECT * FROM wash_logs ORDER BY date DESC, created_at DESC, id DESC')
    .all() as WashRow[];
  const washEntries = washRows
    .filter((r) => r.cost_eur != null)
    .map((r) => ({ userId: r.user_id, amountEur: r.cost_eur as number, type: 'shared' as EntryType }));

  // --- Incidencias: SOLO las resueltas con importe cuentan (resolver = ya se pagó o se reparó).
  // Una abierta, aunque tenga importe previsto, no mueve el saldo: nadie ha puesto el dinero.
  // El reparto individual se expresa con `payerShareEur` (la misma palanca que los pagos):
  // si el responsable es el pagador, lo asume entero; si no, lo asume el otro por completo.
  const incidentRows = listIncidentRows();
  const incidentEntries = incidentRows
    .filter((r) => r.status === 'resolved' && r.amount_eur != null && r.paid_by != null)
    .map((r) => ({
      userId: r.paid_by as number,
      amountEur: r.amount_eur as number,
      type: 'shared' as EntryType,
      payerShareEur:
        r.type === 'individual'
          ? r.responsible_user_id === r.paid_by
            ? (r.amount_eur as number)
            : 0
          : undefined,
    }));
  const incidentTotalPerUser = totalsWithUser(
    computeBalance(incidentEntries, userA.id, userB.id).totalPerUser,
  );
  const openIncidents = incidentRows.filter((r) => r.status === 'open');
  const pendingAmountEur = round2(
    openIncidents.reduce((sum, r) => sum + (r.amount_eur ?? 0), 0),
  );

  // --- Saldo combinado (gasolina + otros + lavados + incidencias resueltas − pagos) ---
  const balanceRaw = computeBalance(
    [...fuelEntries, ...otherEntries, ...washEntries, ...incidentEntries, ...settlementEntries],
    userA.id,
    userB.id,
  );
  const balance: BalanceDto = {
    settled: balanceRaw.settled,
    amountEur: balanceRaw.amountEur,
    fromUser: balanceRaw.fromUserId != null ? requireUser(usersById, balanceRaw.fromUserId) : null,
    toUser: balanceRaw.toUserId != null ? requireUser(usersById, balanceRaw.toUserId) : null,
  };

  const history: WashEntryDto[] = washRows.map((row) => ({
    ...toWashDto(row),
    user: requireUser(usersById, row.user_id),
  }));
  const lastRow = washRows[0] ?? null;
  const last: WashEntryDto | null = lastRow
    ? { ...toWashDto(lastRow), user: requireUser(usersById, lastRow.user_id) }
    : null;
  // Alternancia compensada: le toca al que va por detrás (si uno lavó de más, al otro le
  // toca tantas veces seguidas como la diferencia) para equilibrar.
  const washCountA = washRows.filter((r) => r.user_id === userA.id).length;
  const washCountB = washRows.filter((r) => r.user_id === userB.id).length;
  const next = nextWash(
    washCountA,
    washCountB,
    lastRow ? lastRow.user_id : null,
    userA.id,
    userB.id,
    rules.firstWashUserId,
  );

  return {
    // `fuel.balance` se mantiene como alias del balance combinado para clientes antiguos (ver interface).
    fuel: { list: fuelList, totalPerUser: fuelTotalPerUser, balance },
    other: { list: otherList, totalPerUser: otherTotalPerUser },
    incidents: {
      list: listIncidents(),
      openCount: openIncidents.length,
      pendingAmountEur,
      totalPerUser: incidentTotalPerUser,
    },
    settlements: { list: settlementList },
    balance,
    wash: {
      last,
      nextWashUser: requireUser(usersById, next.nextUserId),
      owedWashes: next.owed,
      history,
    },
  };
}
