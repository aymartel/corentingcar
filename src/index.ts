import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

app.listen(env.PORT, () => {
  console.log(
    `🚗 CoRetingCar backend escuchando en ${env.BASE_URL} ` +
      `(puerto ${env.PORT}, entorno ${env.NODE_ENV})`,
  );
});
