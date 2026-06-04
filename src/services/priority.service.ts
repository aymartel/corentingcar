import { db } from '../db/connection.js';
import { AppError } from '../utils/app-error.js';
import { getRules } from './rules.service.js';
import { findUserById, getOtherUserId, toUserDto } from './users.service.js';
import { getHandover, getHandoversForMonth } from './handover.service.js';
import { resolvePriority, conflictPhrase, type PrioritySource } from './priority.core.js';
import { todayInTimezone, enumerateMonthDays } from '../utils/date.js';
import type { UserDto } from '../models/user.js';
import type { HandoverOrigin } from '../models/handover.js';

function userDtoById(id: number): UserDto {
  const user = findUserById(id);
  if (!user) {
    throw new AppError('NOT_FOUND', `Usuario ${id} no encontrado.`, 404);
  }
  return toUserDto(user);
}

export interface PriorityResult {
  date: string;
  priorityUser: UserDto;
  source: PrioritySource;
}

/** Prioridad efectiva (aplicando handover) de una fecha concreta. */
export function getPriorityForDate(date: string): PriorityResult {
  const rules = getRules();
  const handover = getHandover(date);
  const { userId, source } = resolvePriority({
    date,
    anchorDate: rules.anchorDate,
    anchorUserId: rules.anchorUserId,
    otherUserId: getOtherUserId(rules.anchorUserId),
    handoverUserId: handover?.effective_priority_user_id ?? null,
  });
  return { date, priorityUser: userDtoById(userId), source };
}

export interface TodayResult extends PriorityResult {
  isMyDay: boolean;
  conflictPhrase: string;
}

/** Prioridad de HOY (en la zona horaria de `rules`) + frase de conflicto + `isMyDay`. */
export function getToday(authUserId?: number): TodayResult {
  const rules = getRules();
  const date = todayInTimezone(rules.timezone);
  const base = getPriorityForDate(date);
  return {
    ...base,
    isMyDay: authUserId != null && authUserId === base.priorityUser.id,
    conflictPhrase: conflictPhrase(base.priorityUser.name),
  };
}

export interface CalendarDay {
  date: string;
  priorityUser: UserDto;
  handover: { origin: HandoverOrigin; requestId: number | null } | null;
}

/** Calendario de un mes `YYYY-MM`: prioridad por día + marca de handover. */
export function getCalendarForMonth(month: string): { month: string; days: CalendarDay[] } {
  const rules = getRules();
  const otherUserId = getOtherUserId(rules.anchorUserId);
  const handovers = getHandoversForMonth(month);
  const usersById = loadUsersById();

  const days: CalendarDay[] = enumerateMonthDays(month).map((date) => {
    const handover = handovers.get(date);
    const { userId } = resolvePriority({
      date,
      anchorDate: rules.anchorDate,
      anchorUserId: rules.anchorUserId,
      otherUserId,
      handoverUserId: handover?.effective_priority_user_id ?? null,
    });
    const priorityUser = usersById.get(userId);
    if (!priorityUser) {
      throw new AppError('NOT_FOUND', `Usuario ${userId} no encontrado.`, 404);
    }
    return {
      date,
      priorityUser,
      handover: handover ? { origin: handover.origin, requestId: handover.request_id } : null,
    };
  });

  return { month, days };
}

function loadUsersById(): Map<number, UserDto> {
  const rows = db.prepare('SELECT id, name, profile, color FROM users').all() as UserDto[];
  return new Map(rows.map((user) => [user.id, user]));
}
