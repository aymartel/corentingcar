import { buildApp } from './app.js';
import { env } from './config/env.js';
import { ensureDatabaseReady } from './db/bootstrap.js';

// Deja la BD lista en el arranque (migración idempotente + seed solo si está vacía).
ensureDatabaseReady();

const app = buildApp();

app.listen(env.PORT, () => {
  console.log(
    `🚗 CoRetingCar backend escuchando en ${env.BASE_URL} ` +
      `(puerto ${env.PORT}, entorno ${env.NODE_ENV})`,
  );
});
