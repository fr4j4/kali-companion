#!/usr/bin/env bash
# =============================================================================
# Kali — dev launcher dentro del contenedor Docker
# =============================================================================
# Arranca los 3 servicios en paralelo con supervisor simple:
#   1. kali-core (uvicorn --reload → 0.0.0.0:8900)
#   2. Vite dev server (HMR → 0.0.0.0:5173)
#   3. nginx (ya lo arrancó el entrypoint, sirve :8080 y proxia a Vite)
#
# Hot-reload:
#   - Python: uvicorn --reload-dir /app/kali-core
#   - React/Vite: HMR nativo, recargar navegador basta
#
# Asume que ya se corrió `pip install -e /app/kali-core` y
# `npm --prefix /app/kali-web install` en la etapa builder del Dockerfile.
# =============================================================================
set -euo pipefail

CORE_DIR="/app/kali-core"
WEB_DIR="/app/kali-web"

# ── Venv POR FLAVOR: el repo se bindea a distintos entornos (host, contenedor
# CPU Debian, contenedor GPU Ubuntu+CUDA) y un venv único se rompe al cambiar
# de base (symlinks de python a rutas inexistentes, deps incompatibles).
# Cada flavor mantiene el suyo, ignorable por git: .venv-cpu / .venv-gpu
if [ -d /usr/local/cuda ] || [ -d /opt/cuda ]; then
  FLAVOR="gpu"
else
  FLAVOR="cpu"
fi
VENV="$CORE_DIR/.venv-$FLAVOR"

log() { echo "[dev-in-docker] $*"; }

# ── Cargar .env si existe (kali-core) ────────────────────────────────────────
if [ -f "$CORE_DIR/.env" ]; then
  log "cargando $CORE_DIR/.env"
  set -a
  # shellcheck disable=SC1091
  source "$CORE_DIR/.env"
  set +a
fi

# ── Venv + deps (automático) ────────────────────────────────────────────────
# Si el venv del flavor NO existe (clon fresco) o existe pero es incompatible
# con este entorno (host / otra base, symlinks muertos, pip roto), se crea o
# recrea desde cero y se instalan las deps. Nada manual.
if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -m uvicorn --version >/dev/null 2>&1; then
  if [ -d "$VENV" ]; then
    log "venv $FLAVOR existente está roto/incompatible; recreando..."
    rm -rf "$VENV"
  fi
  log "creando venv en $VENV e instalando deps de kali-core..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -e "$CORE_DIR" piper-tts numpy scipy
fi

# ── Instalar deps node si hace falta ────────────────────────────────────────
if [ ! -d "$WEB_DIR/node_modules" ]; then
  log "instalando deps de kali-web (primera corrida)"
  npm --prefix "$WEB_DIR" install
fi

# ── Arranca kali-core (uvicorn --reload, factory) ──────────────────────────
# kali_core/__main__.py no expone `app`; la factory vive en
# kali_core.server:create_app() (ver server.py:~3585). Por eso usamos
# `module:factory` con --factory.
log "arrancando kali-core en 0.0.0.0:8900 (reload on)..."
(
  cd "$CORE_DIR"
  exec "$VENV/bin/python" -m uvicorn kali_core.server:create_app \
    --host 0.0.0.0 --port 8900 \
    --factory \
    --reload \
    --reload-dir "$CORE_DIR/kali_core" \
    --ws-max-size 52428800
) &
CORE_PID=$!

# ── Espera a que kali-core responda antes de levantar Vite ──────────────────
log "esperando a kali-core (/health)..."
READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:8900/health" >/dev/null 2>&1; then
    log "kali-core listo"
    READY=1
    break
  fi
  if ! kill -0 "$CORE_PID" 2>/dev/null; then
    log "ERROR: kali-core murió antes de estar listo"
    exit 1
  fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  log "WARN: kali-core no respondió en 60s, arranco Vite igual"
fi

# ── Arranca Vite dev (HMR) ──────────────────────────────────────────────────
log "arrancando Vite dev en 0.0.0.0:5173 (HMR on)..."
(
  cd "$WEB_DIR"
  exec npm run dev -- --host 0.0.0.0 --port 5173
) &
WEB_PID=$!

# ── Supervisor: si muere uno, matar el otro y salir ────────────────────────
cleanup() {
  log "apagando… (core=$CORE_PID web=$WEB_PID)"
  kill "$CORE_PID" "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "todo arriba. nginx (entrypoint) sirve :8080 → Vite :5173 → kali-core :8900"
log "HMR: editá kali-web/src/ y el navegador se refresca solo"
log "CTRL+C para bajar"

# Espera a que cualquiera de los dos procesos muera; entonces bajamos todo
wait -n "$CORE_PID" "$WEB_PID"
log "uno de los procesos murió, bajando el stack"
exit 1
