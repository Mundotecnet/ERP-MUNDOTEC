#!/usr/bin/env bash
# Preparación de servidor Ubuntu/Debian para el ERP MundoTec.
# Ejecutar como root o con sudo:  sudo bash install_server.sh
set -euo pipefail

echo ">> Actualizando sistema..."
apt-get update && apt-get -y upgrade

echo ">> Paquetes base..."
apt-get install -y ca-certificates curl gnupg git ufw fail2ban

echo ">> Instalando Docker + Compose..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ">> Firewall (solo SSH, HTTP, HTTPS)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ">> Carpetas de entornos..."
mkdir -p /srv/erp-prod /srv/erp-dev

echo ">> Listo."
echo "   - Docker:  $(docker --version)"
echo "   - Compose: $(docker compose version)"
echo ""
echo "Siguiente:"
echo "  1) Clona el repo en /srv/erp-prod y /srv/erp-dev (ramas main y develop)."
echo "  2) Copia .env.example a .env en cada uno y completa las variables."
echo "  3) Emite los certificados TLS con certbot (ver guía)."
echo "  4) docker compose up -d --build"
