import type { RequestHandler } from 'express';
import { ok } from '../utils/api-response.js';
import { getToday, getPriorityForDate, getCalendarForMonth } from '../services/priority.service.js';

/** GET /api/priority/today */
export const todayController: RequestHandler = (req, res) => {
  res.json(ok(getToday(req.authUser?.id)));
};

/** GET /api/priority?date=YYYY-MM-DD */
export const priorityController: RequestHandler = (req, res) => {
  const { date } = req.query as { date: string };
  res.json(ok(getPriorityForDate(date)));
};

/** GET /api/calendar?month=YYYY-MM */
export const calendarController: RequestHandler = (req, res) => {
  const { month } = req.query as { month: string };
  res.json(ok(getCalendarForMonth(month)));
};
