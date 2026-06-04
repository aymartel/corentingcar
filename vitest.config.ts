import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Los tests NUNCA tocan la BD real: usan SQLite en memoria. Se fijan también las demás
    // variables (BASE_URL evita la colisión con la `BASE_URL='/'` que inyecta Vite/Vitest).
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BASE_URL: 'http://localhost:3000',
      CORS_ORIGINS: '*',
      SESSION_TOKEN_SECRET: 'test-secret',
    },
  },
});
