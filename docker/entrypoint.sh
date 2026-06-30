#!/usr/bin/env bash
# =============================================================================
# Kali — Docker Entrypoint
# =============================================================================
# 1. Descarga modelos si no existen en /app/models/
# 2. Si el provider es qwen3*, arranca tts-server en background
# 3. Arranca nginx + kali-core
# 4. Captura SIGTERM/SIGINT para graceful shutdown
# =============================================================================
set -euo pipefail

APP_DIR="/app"
MODELS_DIR="/app/models"
DATA_DIR="/app/data"
SCRIPTS_DIR="/app/scripts"
KALI_CORE_DIR="/app/kali-core"
QWEN_CPP_DIR="/app/qwen-cpp"

# Colores para logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[kali]${NC} $*"; }
warn() { echo -e "${YELLOW}[kali]${NC} $*"; }
err()  { echo -e "${RED}[kali]${NC} $*"; }

# ── Model download helpers ───────────────────────────────────────────────────

download_stt_models() {
    local stt_provider="${KALI_STT_PROVIDER:-vosk}"

    case "$stt_provider" in
        vosk)
            download_vosk_models
            ;;
        qwen3)
            warn "STT provider 'qwen3' is not yet implemented — skipping STT model download"
            ;;
        *)
            warn "Unknown STT provider '${stt_provider}' — skipping STT model download"
            ;;
    esac
}

download_vosk_models() {
    local es_dir="$MODELS_DIR/vosk-model-small-es-0.42"
    local en_dir="$MODELS_DIR/vosk-model-small-en-us-0.15"

    if [ -d "$es_dir" ] && [ -f "$es_dir/am/final.mdl" ]; then
        log "STT model (es) already present"
    else
        log "Downloading STT model (es)..."
        mkdir -p "$MODELS_DIR"
        local tmp
        tmp="$(mktemp -d)"
        curl -L -o "$tmp/model.zip" "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
        unzip -q "$tmp/model.zip" -d "$MODELS_DIR"
        rm -rf "$tmp"
        log "STT model (es) installed"
    fi

    if [ -d "$en_dir" ] && [ -f "$en_dir/am/final.mdl" ]; then
        log "STT model (en) already present"
    else
        log "Downloading STT model (en)..."
        mkdir -p "$MODELS_DIR"
        local tmp
        tmp="$(mktemp -d)"
        curl -L -o "$tmp/model.zip" "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
        unzip -q "$tmp/model.zip" -d "$MODELS_DIR"
        rm -rf "$tmp"
        log "STT model (en) installed"
    fi
}

download_piper_voices() {
    local voices_dir="$MODELS_DIR/piper-voices"
    local model_file="$voices_dir/es_ES-davefx-medium.onnx"
    local config_file="$voices_dir/es_ES-davefx-medium.onnx.json"

    if [ -f "$model_file" ] && [ -f "$config_file" ]; then
        log "Piper voice model already present"
        return
    fi

    log "Downloading Piper voice model (es_ES-davefx-medium)..."
    mkdir -p "$voices_dir"

    curl -L -o "$model_file" \
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx"
    curl -L -o "$config_file" \
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json"

    log "Piper voice model installed"
}

download_qwen_models() {
    local provider="${KALI_TTS_PROVIDER:-inproc}"
    local quant="${KALI_QWEN_QUANT:-Q4_K_M}"

    # Tokenizer (shared)
    local tokenizer_file="$MODELS_DIR/qwen-tokenizer-12hz-${quant}.gguf"
    if [ ! -f "$tokenizer_file" ]; then
        log "Downloading Qwen3 tokenizer (${quant})..."
        curl -L -o "$tokenizer_file" \
            "https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/qwen-tokenizer-12hz-${quant}.gguf"
    else
        log "Qwen3 tokenizer already present"
    fi

    # Talker model
    local talker_model
    local talker_file
    if [ "$provider" = "qwen3-voicedesign" ]; then
        talker_model="1.7b-voicedesign"
    else
        talker_model="0.6b-customvoice"
    fi
    talker_file="$MODELS_DIR/qwen-talker-${talker_model}-${quant}.gguf"

    if [ ! -f "$talker_file" ]; then
        log "Downloading Qwen3 talker model (${talker_model}, ${quant})..."
        curl -L -o "$talker_file" \
            "https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/qwen-talker-${talker_model}-${quant}.gguf"
    else
        log "Qwen3 talker model (${talker_model}) already present"
    fi
}

# ── Symlink models to expected locations ─────────────────────────────────────

setup_model_symlinks() {
    mkdir -p "$KALI_CORE_DIR/kali_core/voice/voices"
    mkdir -p "$KALI_CORE_DIR/kali_core/ear/models"
    mkdir -p "$KALI_CORE_DIR/kali_core/voice/qwen_models"

    # Piper voices
    local piper_src="$MODELS_DIR/piper-voices"
    if [ -d "$piper_src" ]; then
        for f in "$piper_src"/*.onnx "$piper_src"/*.onnx.json; do
            if [ -f "$f" ]; then
                ln -sf "$f" "$KALI_CORE_DIR/kali_core/voice/voices/$(basename "$f")"
            fi
        done
    fi

    # Vosk STT models
    for model_dir in "$MODELS_DIR"/vosk-model-*; do
        if [ -d "$model_dir" ]; then
            ln -sfn "$model_dir" "$KALI_CORE_DIR/kali_core/ear/models/$(basename "$model_dir")"
        fi
    done

    # Qwen3 models
    for f in "$MODELS_DIR"/qwen-*.gguf; do
        if [ -f "$f" ]; then
            ln -sf "$f" "$KALI_CORE_DIR/kali_core/voice/qwen_models/$(basename "$f")"
        fi
    done
}

# ── Qwen3 C++ server lifecycle ───────────────────────────────────────────────

QWEN_PID=""

start_qwen_server() {
    local binary="${KALI_QWEN_BINARY:-/app/qwen-cpp/build/tts-server}"
    local talker="${KALI_QWEN_TALKER_MODEL:-/app/models/qwen-talker-0.6b-customvoice-Q4_K_M.gguf}"
    local codec="${KALI_QWEN_CODEC_MODEL:-/app/models/qwen-tokenizer-12hz-Q4_K_M.gguf}"
    local port="${KALI_QWEN_PORT:-8870}"
    local backend="${KALI_QWEN_BACKEND:-CPU}"

    if [ "$tts_provider" = "qwen3-voicedesign" ]; then
        talker="${KALI_QWEN_VOICEDESIGN_MODEL:-/app/models/qwen-talker-1.7b-voicedesign-Q4_K_M.gguf}"
    fi

    if [ ! -x "$binary" ]; then
        err "Qwen3 binary not found: $binary"
        err "Make sure the Docker image was built correctly."
        exit 1
    fi

    if [ ! -f "$talker" ]; then
        err "Qwen3 talker model not found: $talker"
        exit 1
    fi

    if [ ! -f "$codec" ]; then
        err "Qwen3 codec model not found: $codec"
        exit 1
    fi

    log "Starting Qwen3 C++ server (backend=${backend}, port=${port})..."

    local log_file="/tmp/qwen-tts-${port}.log"

    if [ "$backend" = "CUDA0" ] || [ "$backend" = "CUDA1" ]; then
        # Use GPU binary if available
        local gpu_binary="${QWEN_CPP_DIR}/build-gpu/tts-server"
        if [ -x "$gpu_binary" ]; then
            binary="$gpu_binary"
            log "Using GPU binary: $gpu_binary"
        else
            warn "GPU binary not found, falling back to CPU binary"
        fi

        export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"
        export GGML_BACKEND="$backend"

        # If nvidia-smi is not available (common in containers), try ldconfig as fallback
        if ! command -v nvidia-smi &>/dev/null; then
            if ldconfig -p 2>/dev/null | grep -q libcuda.so; then
                log "CUDA driver library detected via ldconfig (nvidia-smi not in container)"
            else
                warn "libcuda.so not found via ldconfig — GPU may not be accessible"
                warn "Ensure --gpus all (or nvidia-container-toolkit) is configured"
            fi
        fi
    fi

    "$binary" \
        --model "$talker" \
        --codec "$codec" \
        --host 127.0.0.1 \
        --port "$port" \
        > "$log_file" 2>&1 &
    QWEN_PID=$!

    # Wait for health check
    local timeout=60
    if [ "$backend" = "CUDA0" ] || [ "$backend" = "CUDA1" ]; then
        timeout=120
    fi

    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if ! kill -0 "$QWEN_PID" 2>/dev/null; then
            err "Qwen3 server exited during startup."
            err "Last log lines:"
            tail -20 "$log_file" 2>/dev/null || true
            exit 1
        fi
        if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
            log "Qwen3 server ready (took ${elapsed}s)"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    err "Qwen3 server did not respond after ${timeout}s."
    err "Last log lines:"
    tail -20 "$log_file" 2>/dev/null || true
    exit 1
}

stop_qwen_server() {
    if [ -n "$QWEN_PID" ] && kill -0 "$QWEN_PID" 2>/dev/null; then
        log "Stopping Qwen3 server (pid=$QWEN_PID)..."
        kill "$QWEN_PID" 2>/dev/null || true
        wait "$QWEN_PID" 2>/dev/null || true
        log "Qwen3 server stopped"
    fi
}

# ── Graceful shutdown ────────────────────────────────────────────────────────

cleanup() {
    log "Shutting down..."
    # Stop kali-core first
    if [ -n "${CORE_PID:-}" ] && kill -0 "$CORE_PID" 2>/dev/null; then
        kill "$CORE_PID" 2>/dev/null || true
        wait "$CORE_PID" 2>/dev/null || true
    fi
    # Stop Qwen3 server
    stop_qwen_server
    # Stop nginx
    nginx -s quit 2>/dev/null || true
    log "Shutdown complete"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# ── Main ─────────────────────────────────────────────────────────────────────

tts_provider="${KALI_TTS_PROVIDER:-inproc}"
stt_provider="${KALI_STT_PROVIDER:-vosk}"

log "============================================"
log " Kali — AI Voice Companion (Docker)"
log " TTS Provider: ${tts_provider}"
log " STT Provider: ${stt_provider}"
log " Models dir:   ${MODELS_DIR}"
log " Data dir:     ${DATA_DIR}"
log "============================================"

# Ensure data directories exist
mkdir -p "$DATA_DIR" "$MODELS_DIR"

# Symlink ~/.local/share/kali → /app/data so Path.home() resolves correctly
# without modifying config.py
mkdir -p "$HOME/.local/share"
ln -sfn "$DATA_DIR" "$HOME/.local/share/kali"

# Download models
log "Checking models..."
download_stt_models
download_piper_voices

if [ "$tts_provider" = "qwen3" ] || [ "$tts_provider" = "qwen3-voicedesign" ]; then
    download_qwen_models
fi

# Symlink models to expected locations
setup_model_symlinks

# Start Qwen3 C++ server if needed
if [ "$tts_provider" = "qwen3" ] || [ "$tts_provider" = "qwen3-voicedesign" ]; then
    start_qwen_server
fi

# Start nginx
log "Starting nginx..."
nginx

# Start kali-core
log "Starting kali-core on 0.0.0.0:${KALI_PORT:-8900}..."
cd "$KALI_CORE_DIR"
python -m kali_core &
CORE_PID=$!

log "Kali is ready!"
log "  Frontend: http://localhost:${KALI_WEB_PORT:-8080}"
log "  API:      http://localhost:${KALI_PORT:-8900}"
log "  Health:   http://localhost:${KALI_PORT:-8900}/health"

# Wait for kali-core to exit
wait "$CORE_PID"
