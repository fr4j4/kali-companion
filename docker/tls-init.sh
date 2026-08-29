#!/usr/bin/env bash
# =============================================================================
# Kali — Generación automática de certificado TLS self-signed
# =============================================================================
# Genera /app/certs/kali.crt + kali.key si KALI_TLS=true y no existe (o está
# por expirar). SANs desde KALI_TLS_HOSTS (coma-separado: IPs y dominios).
# Uso: source este script desde los entrypoints (prod/dev).
#
# Variables de entorno:
#   KALI_TLS          "true" habilita TLS (default false)
#   KALI_TLS_HOSTS    hosts para el cert (default: companion.local,localhost)
#   KALI_CERT_DIR     dir destino (default /app/certs)
# =============================================================================
kali_tls_init() {
    if [ "${KALI_TLS:-false}" != "true" ]; then
        return 0
    fi

    local cert_dir="${KALI_CERT_DIR:-/app/certs}"
    local crt="$cert_dir/kali.crt"
    local key="$cert_dir/kali.key"
    # Regenerar si falta o vence en < 30 días
    if [ -f "$crt" ] && openssl x509 -enddate -noout -in "$crt" 2>/dev/null | \
        awk -v now="$(date +%s)" '{ cmd="date -d \"" $4 " " $3 " " $6 "\" +%s"; cmd | getline t; close(cmd); if (t - now > 2592000) exit 1 }'; then
        log "cert TLS vigente en $crt"
        return 0
    fi

    local hosts="${KALI_TLS_HOSTS:-companion.local,localhost}"
    mkdir -p "$cert_dir"

    # Construir SANs: IP:x para IPs, DNS:x para dominios
    local san="" cn=""
    IFS=',' read -ra parts <<< "$hosts"
    for h in "${parts[@]}"; do
        h="$(echo "$h" | xargs)"; [ -z "$h" ] && continue
        if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            san+="IP:$h,"
        else
            san+="DNS:$h,"
        fi
        [ -z "$cn" ] && cn="$h"
    done
    san="${san%,}"; cn="${cn:-kali.local}"

    log "generando cert TLS self-signed (CN=$cn SAN=$san)..."
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
        -keyout "$key" -out "$crt" \
        -subj "/CN=$cn" \
        -addext "subjectAltName=$san" \
        -addext "basicConstraints=CA:FALSE" \
        -addext "keyUsage=digitalSignature,keyEncipherment" \
        -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1 || {
            warn "falló la generación del cert TLS; continuando sin TLS"
            rm -f "$crt" "$key"
            return 1
        }
    chmod 644 "$crt"; chmod 600 "$key"
    log "cert TLS listo (825 días). Los clientes aceptan el warning una vez,"
    log "o importan la CA: el cert se sirve también en /kali.crt vía nginx."
    return 0
}