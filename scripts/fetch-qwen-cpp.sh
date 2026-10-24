#!/usr/bin/env bash
# Download the prebuilt Qwen3-TTS engine (tts-server) from the
# qwen-tts-cpp-server GitHub release. Nothing is compiled.
#
# Usage:
#   ./scripts/fetch-qwen-cpp.sh              # auto: cuda if an NVIDIA GPU is present, else vulkan
#   ./scripts/fetch-qwen-cpp.sh cuda         # CPU + CUDA 12 (NVIDIA, driver >= 525), ~420 MB
#   ./scripts/fetch-qwen-cpp.sh vulkan       # CPU + Vulkan (NVIDIA/AMD/Intel, CPU if no Vulkan), ~25 MB
#   QWEN_CPP_VERSION=0.1.0 ./scripts/fetch-qwen-cpp.sh
#
# Installs to kali-core/kali_core/voice/qwen_cpp/<variant>/ (tts-server plus its
# libraries, relocatable). kali-core resolves it automatically; both packages
# include the CPU backend, so either one runs without a GPU.
#
# Your own build of github.com/fr4j4/qwen-tts-cpp-server works too: set
# KALI_QWEN_BINARY=/path/to/tts-server and skip this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CPP_DIR="$SCRIPT_DIR/../kali-core/kali_core/voice/qwen_cpp"

VERSION="${QWEN_CPP_VERSION:-0.1.0}"
REPO_URL="https://github.com/fr4j4/qwen-tts-cpp-server/releases/download/v${VERSION}"
VARIANT="${1:-auto}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ;;
  *) echo "ERROR: prebuilt packages exist for Linux x86_64 only (got $(uname -s)-$(uname -m))."
     echo "  Build github.com/fr4j4/qwen-tts-cpp-server yourself and set KALI_QWEN_BINARY."
     exit 1 ;;
esac

if [ "$VARIANT" = "auto" ]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    VARIANT=cuda
  else
    VARIANT=vulkan
  fi
fi
if [ "$VARIANT" != "cuda" ] && [ "$VARIANT" != "vulkan" ]; then
  echo "Usage: $0 [auto|cuda|vulkan]"
  exit 1
fi

DEST="$CPP_DIR/$VARIANT"
if [ -x "$DEST/tts-server" ] && [ "$(cat "$DEST/.version" 2>/dev/null)" = "$VERSION" ]; then
  echo "[OK] qwen-tts $VERSION ($VARIANT) already installed at $DEST"
  exit 0
fi

NAME="qwen-tts-${VERSION}-linux-x64-${VARIANT}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[Download] $NAME.tar.gz"
curl -fL --retry 3 -o "$TMP/$NAME.tar.gz" "$REPO_URL/$NAME.tar.gz"
curl -fsSL --retry 3 -o "$TMP/$NAME.tar.gz.sha256" "$REPO_URL/$NAME.tar.gz.sha256"
( cd "$TMP" && sha256sum -c "$NAME.tar.gz.sha256" )

rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$TMP/$NAME.tar.gz" -C "$DEST" --strip-components=1
echo "$VERSION" > "$DEST/.version"

if [ ! -x "$DEST/tts-server" ]; then
  echo "ERROR: tts-server not found in the package."
  exit 1
fi
echo ""
echo "=== Installed: $DEST/tts-server (v$VERSION, $VARIANT) ==="
echo "Next: ./scripts/download-qwen-models.sh   # GGUF voice models"
