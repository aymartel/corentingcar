// Garantiza que cualquier test de integración use SQLite EN MEMORIA, nunca la BD real.
// Debe importarse ANTES que cualquier módulo que abra la conexión (config/env, db/connection).
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
// Vite/Vitest inyecta BASE_URL='/', que no es una URL válida; la fijamos a una válida.
process.env.BASE_URL = 'http://localhost:3000';
