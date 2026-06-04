#!/bin/bash
set -euxo pipefail

# Instala Docker + plugin compose en Amazon Linux 2023 y prepara el directorio de la app.
dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Docker Compose v2 (plugin CLI).
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Carpeta de la app y del volumen SQLite (persiste entre redeploys del contenedor).
mkdir -p /home/ec2-user/coretingcar/data
chown -R ec2-user:ec2-user /home/ec2-user/coretingcar
