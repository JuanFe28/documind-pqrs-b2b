#!/usr/bin/env bash
# ==============================================================================
# Despliegue del stack DocuMind / PQRS en Oracle Cloud Always Free (ARM64)
# Ejecutar desde /home/ubuntu/documind-pqrs-b2b
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.oracle.yml"

echo "=============================================================="
echo "[1/5] Deteniendo contenedores existentes..."
echo "=============================================================="
docker compose -f "$COMPOSE_FILE" down

echo "=============================================================="
echo "[2/5] Construyendo imagenes backend y frontend (--no-cache)..."
echo "=============================================================="
docker compose -f "$COMPOSE_FILE" build --no-cache backend frontend

echo "=============================================================="
echo "[3/5] Levantando el stack..."
echo "=============================================================="
docker compose -f "$COMPOSE_FILE" up -d

echo "=============================================================="
echo "[4/5] Esperando 10 segundos y verificando contenedores..."
echo "=============================================================="
sleep 10
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo "=============================================================="
echo "[5/5] Extrayendo URL publica HTTPS de trycloudflare..."
echo "=============================================================="
CF_URL="$(docker logs documind_tunnel 2>&1 | grep -Eo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | tail -n 1 || true)"
if [ -n "$CF_URL" ]; then
  echo ""
  echo "URL publica HTTPS: $CF_URL"
  echo ""
else
  echo "Aun no hay URL disponible."
  echo "Espera unos segundos y ejecuta: docker logs documind_tunnel"
fi
