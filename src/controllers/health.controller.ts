import type { RequestHandler } from 'express';
import { ok } from '../utils/api-response.js';
import { APP_VERSION } from '../config/version.js';

/** GET /api/health — healthcheck para despliegue/monitorización. */
export const healthController: RequestHandler = (_req, res) => {
  res.json(ok({ status: 'ok', version: APP_VERSION }));
};
