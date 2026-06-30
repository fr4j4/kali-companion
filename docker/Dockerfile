# syntax=docker/dockerfile:1

# =============================================================================
# Kali — AI Voice Companion (CPU)
# =============================================================================
# Multi-stage build: compiles Qwen3 C++ binary + kali-web, then produces
# a slim runtime image with nginx + kali-core.
#
# Build:
#   docker build -f docker/Dockerfile -t kali:latest .
#
# Run (Piper TTS, default):
#   docker run -d --name kali \
#     -p 8900:8900 -p 8080:80 \
#     -v kali-models:/app/models \
#     -v kali-data:/app/data \
#     --device /dev/snd \
#     kali:latest
#
# Run (Qwen3 TTS):
#   docker run -d --name kali \
#     -p 8900:8900 -p 8080:80 \
#     -v kali-models:/app/models \
#     -v kali-data:/app/data \
#     --device /dev/snd \
#     -e KALI_TTS_PROVIDER=qwen3 \
#     kali:latest
# =============================================================================

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Build deps for Qwen3 C++ server
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    g++ \
    git \
    make \
    pkg-config \
    nodejs \
    npm \
    libopenblas-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone and build Qwen3 C++ server (CPU)
ARG QWEN_REPO=https://github.com/fr4j4/qwen-tts-cpp-server.git
ARG QWEN_BRANCH=voicedesign
RUN git clone --branch ${QWEN_BRANCH} --depth 1 ${QWEN_REPO} qwen-cpp \
    && cd qwen-cpp \
    && git submodule update --init --recursive

WORKDIR /build/qwen-cpp
RUN mkdir build && cd build \
    && cmake .. -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS \
    && cmake --build . --config Release -j "$(nproc)"

# Build kali-web frontend
WORKDIR /build/kali-web
COPY kali-web/package.json kali-web/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install
COPY kali-web/ ./
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

# Runtime deps: nginx, audio (ALSA + PulseAudio), BLAS, download tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    build-essential \
    libopenblas0 \
    libasound2 \
    libpulse0 \
    pulseaudio-utils \
    alsa-utils \
    curl \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --uid 1000 --shell /bin/bash kali

# App directories
RUN mkdir -p /app/kali-core /app/kali-web /app/models /app/data \
    && chown -R kali:kali /app

# Set HOME so Path.home() resolves to /home/kali.
# The entrypoint symlinks ~/.local/share/kali → /app/data for persistence.
ENV HOME=/home/kali

WORKDIR /app

# Copy Qwen3 C++ binary from builder
COPY --from=builder --chown=kali:kali /build/qwen-cpp/build/tts-server /app/qwen-cpp/build/tts-server

# Copy kali-web dist from builder
COPY --from=builder --chown=kali:kali /build/kali-web/dist /app/kali-web/dist

# Copy kali-core source
COPY --chown=kali:kali kali-core/ /app/kali-core/

# Copy scripts for model downloads
COPY --chown=kali:kali scripts/ /app/scripts/

# README needed by hatchling build metadata (pyproject.toml: readme = "../README.md")
COPY --chown=kali:kali README.md /app/README.md

# Install kali-core + deps
RUN pip install --no-cache-dir \
    /app/kali-core \
    piper-tts \
    numpy \
    scipy \
    vosk

# Copy and configure nginx
COPY docker/nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Copy entrypoint
COPY --chown=kali:kali docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose ports
# 8900 = kali-core WebSocket + HTTP API
# 80   = nginx (kali-web static files + WS proxy)
EXPOSE 8900 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8900/health || exit 1

STOPSIGNAL SIGTERM

USER kali
ENTRYPOINT ["/app/entrypoint.sh"]
