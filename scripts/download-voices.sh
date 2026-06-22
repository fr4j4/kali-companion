#!/usr/bin/env bash
# Download Piper voice models for kali-voice.
#
# Phase 1 will populate this. For now it just prints instructions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOICES_DIR="$ROOT/kali-core/kali_core/voice/voices"

echo "Piper voice models should be placed in:"
echo "  $VOICES_DIR"
echo
echo "Default voice (referenced by voice_configs/robot-es.json):"
echo "  es_ES-davefx-medium.onnx"
echo "  es_ES-davefx-medium.onnx.json"
echo
echo "Download from https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/davefx/medium"
echo
echo "Phase 1 will automate this."