# syntax=docker/dockerfile:1

# ---------- Build stage ----------
# Debian-slim (glibc) para que better-sqlite3 use sus binarios precompilados (no Alpine/musl).
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# Dependencias primero (mejor cacheo).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# Código y build de producción.
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---------- Runtime stage ----------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
# Solo dependencias de producción (better-sqlite3 baja su prebuilt para linux).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
# Artefactos compilados.
COPY --from=build /app/dist ./dist

# Valores por defecto (sobreescribibles por la plataforma / .env).
ENV PORT=3000
ENV DATABASE_PATH=/data/coche.db
EXPOSE 3000

# IMPORTANTE: la BD SQLite vive en /data, que DEBE ser un volumen persistente.
# Sin volumen montado en /data se pierden los datos en cada redeploy.
VOLUME ["/data"]

# Healthcheck sin dependencias extra (Node 24 trae fetch global). deploy.sh espera 'healthy'.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Arranca el servidor; index.ts ejecuta migración + seed-si-vacía antes de escuchar.
CMD ["node", "dist/index.js"]
