#!/usr/bin/env bash
# =============================================================================
# Kali — Docker Entrypoint (modo dev con hot-reload)
# =============================================================================
# Reemplaza al entrypoint de producción cuando se usa docker-compose.override.yml.
#
# Responsabilidades:
#   1. Descargar modelos TTS/STT que falten (igual que prod)
#   2. Configurar symlinks de modelos
#   3. Arrancar nginx con la config de dev (proxy a Vite :5173)
#   4. Ejecutar el dev launcher (uvicorn --reload + Vite dev)
#
# El dev launcher se hace cargo del lifecycle de uvicorn + Vite.
# =============================================================================
set -uo pipefail

APP_DIR="/app"
MODELS_DIR="/app/models"
DATA_DIR="/app/data"
SCRIPTS_DIR="/app/scripts"
KALI_CORE_DIR="/app/kali-core"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[kali-dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[kali-dev]${NC} $*"; }
err()  { echo -e "${RED}[kali-dev]${NC} $*" >&2; }

# ── Validaciones tempranas ──────────────────────────────────────────────────
[ -f /app/docker/nginx-dev.conf ] || { err "falta /app/docker/nginx-dev.conf"; exit 1; }
[ -x /app/docker/scripts/dev-in-docker.sh ] || { err "falta /app/docker/scripts/dev-in-docker.sh (no es ejecutable)"; exit 1; }

# ── Reemplazar config de nginx por la de dev ────────────────────────────────
# El Dockerfile copia docker/nginx.conf como /etc/nginx/nginx.conf (root:root,
# no escribible por el user 'kali'). Para dev ensamblamos una config en /tmp/
# con main{} + events{} + http{abierto (de nginx-main.conf) + server{} (de
# nginx-dev.conf) + cierre }.
#
# nginx-main.conf NO incluye /etc/nginx/sites-enabled/* ni /etc/nginx/conf.d/*
# para no chocar con el default server de prod que está en sites-enabled/default.

log "configurando nginx en modo dev (proxy a Vite :5173 + WS a kali-core)..."
NGINX_CONF=/tmp/nginx.conf

# TLS opcional por .env: generar cert si KALI_TLS=true (idempotente)
if [ -f /app/docker/tls-init.sh ]; then
    # shellcheck disable=SC1091
    source /app/docker/tls-init.sh
    kali_tls_init
    TLS_ENABLED="$([ "${KALI_TLS:-false}" = "true" ] && [ -f /app/certs/kali.crt ] && echo 1 || echo 0)"
    TLS_LISTEN=""
    if [ "$TLS_ENABLED" = "1" ]; then
        # "http2 on" (sintaxis moderna) no existe en el nginx de Ubuntu 24.04
        # (1.24); ahí http2 va como flag del listen. Detectamos y usamos una.
        if nginx -v 2>&1 | grep -qE "/1\.(2[5-9]|[3-9][0-9])"; then
            TLS_LISTEN="listen ${KALI_TLS_PORT:-8444} ssl;
    http2 on;
    ssl_certificate     /app/certs/kali.crt;
    ssl_certificate_key /app/certs/kali.key;"
        else
            TLS_LISTEN="listen ${KALI_TLS_PORT:-8444} ssl http2;
    ssl_certificate     /app/certs/kali.crt;
    ssl_certificate_key /app/certs/kali.key;"
        fi
    fi
else
    TLS_LISTEN=""
fi

# Ensamblar nginx.conf en /tmp (escribible por kali). Usamos python en vez
# de `cat ... ; echo }` porque bash dentro de este container tiene un bug
# bizarro que duplica lineas al concatenar. Python es predecible.
python3 - "$NGINX_CONF" "$TLS_LISTEN" << 'PYEOF'
import re
import sys
out = sys.argv[1]
tls_listen = sys.argv[2] if len(sys.argv) > 2 else ""
with open("/app/docker/nginx-main.conf") as f:
    main = f.read()
# nginx-main.conf es un archivo completo (sirve también como /etc/nginx/
# nginx.conf en prod), por lo que cierra http{} e incluye sites-enabled/*.
# Para dev: quitamos esos includes (traerían el server de prod) y su llave
# de cierre final, dejando http{} ABIERTO para que nginx-dev.conf aporte
# el server{} y cerremos nosotros.
main = re.sub(r"\n[ \t]*include /etc/nginx/(?:conf\.d|sites-enabled)/[^;]+;", "", main)
main = re.sub(r"\}[ \t]*\n?[ \t]*$", "\n", main)
with open("/app/docker/nginx-dev.conf") as f:
    dev = f.read()
# Modo TLS opcional (KALI_TLS=true): el listen 8080 se sustituye por el
# bloque ssl (puerto KALI_TLS_PORT, cert en /app/certs). Sin TLS queda
# byte a byte igual que antes.
if tls_listen:
    dev = re.sub(r"listen 8080 default_server;\n(\s*)listen \[::\]:8080 default_server;",
                 tls_listen, dev, count=1)
    dev = dev.replace('ssl_certificate     /app/certs/kali.crt;',
                      'ssl_certificate     /app/certs/kali.crt;')
# Servir el cert público para fácil import en clientes (solo TLS)
if tls_listen:
    dev = dev.replace(
        "    # ── SPA",
        "    location /kali.crt { alias /app/certs/kali.crt; default_type application/pkix-cert; }\n\n    # ── SPA", 1)
# nginx-dev.conf ya cierra el server{}. Agregamos solo el cierre del http{.
combined = main + dev + "}\n"
with open(out, "w") as f:
    f.write(combined)
import os
os.chown(out, 1000, 1000)
PYEOF

# Validar antes de arrancar. Usamos el exit code de nginx -t directamente:
# con `set -o pipefail`, un `grep -q` en el pipe mataba a tee con SIGPIPE
# (grep -q corta apenas encuentramatch) y daba falso negativo con la config OK.
if ! nginx -t -c "$NGINX_CONF" >/tmp/nginx-test.log 2>&1; then
  err "configuración de nginx inválida (ver /tmp/nginx-test.log)"
  cat /tmp/nginx-test.log >&2
  exit 1
fi
log "nginx -t OK, arrancando..."

# Limpiar PID de runs anteriores (kalivaluvuelvue a arrancar nginx)
rm -f /tmp/nginx.pid

# ── Descarga de modelos ─────────────────────────────────────────────────────
#     En dev inproc (Piper) no descargamos nada al arranque; el primer uso
#     del STT/TTS los baja on-demand. Para Qwen3, ver scripts/download-qwen-models.sh.
if [ "${KALI_TTS_PROVIDER:-inproc}" = "qwen3" ] || [ "${KALI_TTS_PROVIDER:-inproc}" = "qwen3-voicedesign" ]; then
  if [ -x "$SCRIPTS_DIR/download-qwen-models.sh" ]; then
    log "verificando modelos Qwen3-TTS..."
    bash "$SCRIPTS_DIR/download-qwen-models.sh" 2>/dev/null || warn "falló descarga Qwen3 (no fatal)"
  fi
fi

# ── Arranca nginx (proxy a Vite) ────────────────────────────────────────────
log "arrancando nginx..."
nginx -c "$NGINX_CONF"
NGINX_PID=$(cat /tmp/nginx.pid 2>/dev/null || echo "")

# ── Lanza el dev launcher (uvicorn --reload + Vite dev) ─────────────────────
#     Este script hace su propio cleanup y se queda en foreground.
log "lanzando dev launcher..."
exec bash /app/docker/scripts/dev-in-docker.sh
