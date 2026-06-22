#!/usr/bin/env bash
# Download Vosk STT models (Spanish + English small).
#
# Usage: scripts/download-stt-models.sh
set -euo pipefail

MODELS_DIR="kali-core/kali_core/ear/models"
mkdir -p "$MODELS_DIR"

ES_MODEL="vosk-model-small-es-0.42"
EN_MODEL="vosk-model-small-en-us-0.15"
ES_URL="https://alphacephei.com/vosk/models/${ES_MODEL}.zip"
EN_URL="https://alphacephei.com/vosk/models/${EN_MODEL}.zip"

download_and_extract() {
  local url="$1"
  local name="$2"
  local dest="$MODELS_DIR/$name"

  if [ -d "$dest" ] && [ -f "$dest/am/final.mdl" ]; then
    echo "✓ $name already present"
    return
  fi

  echo "Downloading $name…"
  tmp="$(mktemp -d)"
  curl -L -o "$tmp/model.zip" "$url"
  echo "Extracting…"
  unzip -q "$tmp/model.zip" -d "$MODELS_DIR"
  rm -rf "$tmp"
  echo "✓ $name installed"
}

download_and_extract "$ES_URL" "$ES_MODEL"
download_and_extract "$EN_URL" "$EN_MODEL"

echo "Done. Models in $MODELS_DIR/"