#!/bin/bash
PORT=${1:-8081}
DIR="$(cd "$(dirname "$0")" && pwd)/experimental"
echo "Sirviendo Singularity v5 en http://0.0.0.0:$PORT"
echo "En tu teléfono: http://192.168.1.14:$PORT/singularity_v5.html"
echo "En tu navegador: http://localhost:$PORT/singularity_v5.html"
echo "Presiona Ctrl+C para detener."
exec python3 -m http.server "$PORT" --directory "$DIR"
