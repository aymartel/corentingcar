# CoRetingCar · Backend

API REST para la app de coche compartido (Andy y Dennis). Stack: **Node + TypeScript + Express + SQLite**.

> Construido por fases. Esta es la base (**B1**); el contrato y el modelo de datos viven en
> [`../prompts/00-context-and-contract.md`](../prompts/00-context-and-contract.md).

## Requisitos
- Node.js **20+** (objetivo 24.x) y **pnpm** (recomendado vía Corepack: `corepack enable pnpm`).

## Puesta en marcha (desarrollo)
```bash
cd backend
cp .env.example .env        # en Windows PowerShell: Copy-Item .env.example .env
pnpm install
pnpm dev
```
El servidor arranca en `http://localhost:3000`. Comprueba la salud:
```bash
curl http://localhost:3000/api/health
# { "ok": true, "data": { "status": "ok", "version": "0.1.0" } }
```

## Scripts
| Script | Acción |
|---|---|
| `pnpm dev` | Servidor con recarga en caliente (`tsx watch`) |
| `pnpm build` | Compila TypeScript a `dist/` |
| `pnpm start` | Ejecuta la build (`node dist/index.js`) |
| `pnpm typecheck` | Comprueba tipos sin emitir |
| `pnpm db:migrate` | Crea/actualiza el esquema SQLite (idempotente) |
| `pnpm db:seed` | Inserta los 2 usuarios (Andy/Dennis) y la configuración `rules` (idempotente) |
| `pnpm db:set-pin <perfil> <pin>` | Cambia el PIN de un usuario directamente en la BD |
| `pnpm test` | Tests (vitest) — se completan en la fase B8 |

## Base de datos (SQLite)
Crea e inicializa la base de datos:
```bash
pnpm db:migrate    # crea el esquema (8 tablas)
pnpm db:seed       # inserta Andy/Dennis + rules (no duplica si ya existen)
```
La ruta del archivo la define `DATABASE_PATH` (por defecto `./data/coche.db`).

### Usuarios y PIN (sin registro)
Los 2 usuarios se crean por **seed** y el PIN se guarda **hasheado** (scrypt), nunca en claro. Los PIN
por defecto del seed (`Andy=1234`, `Dennis=5678`) pueden fijarse con variables de entorno antes de
sembrar (`ANDY_PIN`, `AMIGO_PIN`) y la fecha ancla con `ANCHOR_DATE`.

Para **cambiar un PIN** más adelante, directamente en la base de datos:
```bash
pnpm db:set-pin andy 4321     # actualiza el pin_hash del perfil 'andy'
pnpm db:set-pin amigo 8765
```
No existe pantalla ni endpoint de registro: el alta y el cambio de PIN se gestionan con estos scripts.

## Variables de entorno
Ver [`.env.example`](.env.example). Todas tienen valor por defecto para desarrollo; en **producción**
`SESSION_TOKEN_SECRET` es obligatorio y debe ser un valor seguro (distinto del de ejemplo).

| Variable | Por defecto | Descripción |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | Puerto del servidor |
| `DATABASE_PATH` | `./data/coche.db` | Ruta del archivo SQLite (volumen en producción) |
| `CORS_ORIGINS` | `*` | Orígenes permitidos, separados por comas |
| `BASE_URL` | `http://localhost:3000` | URL base pública |
| `SESSION_TOKEN_SECRET` | `dev-secret-change-me` | Secreto de tokens de sesión |

## Convenciones (resumen)
- **Código en inglés**, textos visibles en español.
- Sobre de respuesta: `{ "ok": true, "data": ... }` / `{ "ok": false, "error": { "code", "message" } }`.
- Todas las rutas bajo el prefijo **`/api`**.

## Elección de librería SQLite: `better-sqlite3`
Para la persistencia (a partir de **B2**) se usa **`better-sqlite3`** en lugar de `node:sqlite`:
- **API síncrona y ergonómica**: simplifica el código en un backend de bajo tráfico para 2 usuarios
  (sin async/await en cada consulta); transacciones y *prepared statements* muy directos.
- **Madurez**: librería estable, muy usada en producción, con amplia documentación y tipos.
- `node:sqlite` (módulo nativo, estable desde Node 22.5+/24) es una alternativa válida sin dependencias
  externas, pero es más nuevo y con menos ejemplos; se prioriza la madurez de `better-sqlite3`.

> En despliegue, `better-sqlite3` requiere **una sola instancia** escribiendo el archivo `.db`, que debe
> vivir en un **volumen persistente** (ver fase B9).

## Estructura
```
src/
  config/        env.ts, version.ts
  db/            (esquema y acceso a datos — B2)
  routes/        index.ts (router /api)
  controllers/   health.controller.ts
  services/      (lógica de negocio — B4+)
  middlewares/   error-handler.ts, not-found.ts, validate.ts
  models/        (tipos/DTOs)
  utils/         api-response.ts, app-error.ts
  app.ts         (fábrica de la app Express, reutilizable en tests)
  index.ts       (entry point: arranca el servidor)
```
