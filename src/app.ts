import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { openapiDocument } from './docs/openapi.js';
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

  // La API es dinámica y autenticada: nada de ETag/304 ni caché en el cliente.
  // (Express añade ETag por defecto y el navegador revalida → 304 con cuerpo
  //  vacío rompía la app web.)
  app.disable('etag');

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

  // Documentación de la API (pública): Swagger UI + el OpenAPI en JSON.
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openapiDocument);
  });
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiDocument, { customSiteTitle: 'CoRetingCar API' }),
  );

  // Respuestas de datos no cacheables (refuerza la desactivación de ETag).
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiRouter);

  // 404 y manejador de errores global SIEMPRE al final.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
