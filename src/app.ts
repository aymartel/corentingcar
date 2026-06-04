import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFound } from './middlewares/not-found.js';
import { errorHandler } from './middlewares/error-handler.js';

/** ¿Está permitido este origen según `CORS_ORIGINS`? `['*']` permite cualquiera. */
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // peticiones sin Origin (curl, apps móviles, same-origin)
  if (env.corsOrigins.includes('*')) return true;
  return env.corsOrigins.includes(origin);
}

/**
 * Fábrica de la app Express. Se exporta para poder reutilizarla en tests (B8) sin
 * arrancar un servidor real.
 */
export function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origen no permitido por CORS'));
        }
      },
      credentials: true,
    }),
  );

  app.use('/api', apiRouter);

  // 404 y manejador de errores global SIEMPRE al final.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
