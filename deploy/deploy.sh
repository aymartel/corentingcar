#!/usr/bin/env bash
# Se ejecuta EN el EC2 desde el workflow de deploy. Carga la imagen, levanta los
# contenedores y espera a que la API esté sana (usa el HEALTHCHECK del contenedor).
# Hace rollback simple si el arranque falla.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Cargando imagen Docker"
docker load -i image.tar.gz
rm -f image.tar.gz

echo "==> Levantando contenedores (compose)"
docker compose up -d --remove-orphans

echo "==> Esperando a que la API esté sana"
for i in $(seq 1 30); do
  cid="$(docker compose ps -q api || true)"
  status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
  if [ "$status" = "healthy" ]; then
    echo "==> API sana ✔"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 5
done

echo "!! La API no llegó a estado 'healthy'. Últimos logs:" >&2
docker compose logs --tail=80 api >&2 || true
exit 1
