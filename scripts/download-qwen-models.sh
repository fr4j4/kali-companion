#!/usr/bin/env bash
# Download Qwen3-TTS GGUF models from HuggingFace.
#
# Usage:
#   ./scripts/download-qwen-models.sh                        # default: 0.6b-customvoice
#   ./scripts/download-qwen-models.sh 0.6b-customvoice     # specific model
#   ./scripts/download-qwen-models.sh 1.7b-voicedesign    # voicedesign model
#   ./scripts/download-qwen-models.sh --all                # all models + tokenizer
#   ./scripts/download-qwen-models.sh --tokenizer          # tokenizer only
#   ./scripts/download-qwen-models.sh 0.6b-customvoice Q8_0  # specific quant
#
# Available talker models:
#   0.6b-base          629 MB (Q4_K_M)  — zero-shot TTS, 9 named speakers
#   0.6b-customvoice   605 MB (Q4_K_M)  — zero-shot TTS + voice cloning (RECOMMENDED)
#   1.7b-base          1.2 GB (Q4_K_M)  — higher quality, 9 named speakers
#   1.7b-customvoice   1.2 GB (Q4_K_M)  — higher quality + voice cloning
#   1.7b-voicedesign   1.2 GB (Q4_K_M)  — voice synthesis from text description
#
# Quantization variants:
#   Q4_K_M   smallest, lowest VRAM     (recommended for GPU < 4GB or CPU)
#   Q8_0     recommended default       (best quality/size ratio)
#   BF16     source faithful, max precision
#   F32      reference, debug only

set -euo pipefail

REPO="Serveurperso/Qwen3-TTS-GGUF"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODEL_DIR="${KALI_TTS_MODELS_DIR:-"$HOME/.local/share/kali/models"}"

mkdir -p "$MODEL_DIR"

QUANT="${2:-Q4_K_M}"
VALID_QUANTS="Q4_K_M Q8_0 BF16 F32"

_url_for() {
  echo "https://huggingface.co/${REPO}/resolve/main/${1}"
}

_dl() {
  local file="$1"
  local url="$(_url_for "$file")"
  if [ -f "$MODEL_DIR/$file" ]; then
    echo "[OK] $file already exists"
    return
  fi
  echo "[Download] $file"
  wget -c -q "$url" -O "$MODEL_DIR/$file"
  if [ $? -ne 0 ]; then
    echo "ERROR: Failed to download $file"
    return 1
  fi
}

_validate_quant() {
  if ! echo "$VALID_QUANTS" | grep -q "$QUANT"; then
    echo "ERROR: Unknown quantization: $QUANT"
    echo "Valid: $VALID_QUANTS"
    exit 1
  fi
}

dl_tokenizer() {
  _dl "qwen-tokenizer-12hz-${QUANT}.gguf"
}

dl_talker() {
  local model="$1"
  _dl "qwen-talker-${model}-${QUANT}.gguf"
}

show_sizes() {
  echo ""
  echo "File sizes:"
  local count=0
  for f in "$MODEL_DIR"/*.gguf; do
    if [ -f "$f" ]; then
      local size
      size="$(ls -lh "$f" 2>/dev/null | awk '{print $5}')"
      echo "  $size  $(basename "$f")"
      count=$((count + 1))
    fi
  done
  if [ "$count" -eq 0 ]; then
    echo "  (no model files found)"
  fi
}

case "${1:-}" in
  --all)
    echo "=== Downloading ALL Qwen3-TTS models ==="
    echo "Target: $MODEL_DIR/"
    echo "Quantization: $QUANT"
    echo ""
    _validate_quant
    dl_talker 0.6b-base
    dl_talker 0.6b-customvoice
    dl_talker 1.7b-base
    dl_talker 1.7b-customvoice
    dl_talker 1.7b-voicedesign
    dl_tokenizer
    show_sizes
    ;;

  --tokenizer)
    echo "=== Downloading Qwen3-TTS tokenizer (codec) ==="
    echo "Target: $MODEL_DIR/"
    echo "Quantization: $QUANT"
    echo ""
    _validate_quant
    dl_tokenizer
    show_sizes
    ;;

  0.6b-base|0.6b-customvoice|1.7b-base|1.7b-customvoice|1.7b-voicedesign)
    echo "=== Downloading Qwen3-TTS ${1} ==="
    echo "Target: $MODEL_DIR/"
    echo "Quantization: $QUANT"
    echo ""
    _validate_quant
    dl_talker "$1"
    dl_tokenizer
    show_sizes
    ;;

  "")
    echo "=== Downloading Qwen3-TTS (default: 0.6b-customvoice) ==="
    echo "Target: $MODEL_DIR/"
    echo "Quantization: $QUANT"
    echo ""
    _validate_quant
    dl_talker 0.6b-customvoice
    dl_tokenizer
    show_sizes
    ;;

  -h|--help)
    echo "Usage:"
    echo "  $0                        # default: 0.6b-customvoice"
    echo "  $0 0.6b-customvoice     # specific model"
    echo "  $0 1.7b-voicedesign     # voicedesign model"
    echo "  $0 --all                 # all models + tokenizer"
    echo "  $0 --tokenizer           # tokenizer only"
    echo "  $0 0.6b-customvoice Q8_0  # specific model + quant"
    echo ""
    echo "Available models:"
    echo "  0.6b-base | 0.6b-customvoice | 1.7b-base | 1.7b-customvoice | 1.7b-voicedesign"
    echo ""
    echo "Available quantizations:"
    echo "  $VALID_QUANTS"
    exit 0
    ;;

  *)
    echo "ERROR: Unknown model: ${1}"
    echo "Run '$0 --help' for usage."
    exit 1
    ;;
esac

echo ""
echo "Done! Models saved to $MODEL_DIR/"