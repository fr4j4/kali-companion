# Kali — Docker Deployment

Full deployment of Kali (kali-core + kali-web) in Docker, with support for multiple TTS/STT engines and GPU acceleration.

## Prerequisites

- **Docker** 24+
- **Docker Compose** 2.x
- **nvidia-container-toolkit** (optional, for GPU support)

## Building the Image

The Docker image compiles everything inside the build stage:
- **Qwen3-TTS C++ binary** (CPU build with OpenBLAS)
- **kali-web frontend** (Vite production build)
- **Python dependencies** (pip install in the runtime image)

No pre-compiled binaries or external models are required on the host.

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/fr4j4/kali-companion kali
cd kali

# 2. Configure environment variables
cp docker/.env.example docker/.env
# Edit KALI_LLM_API_URL in docker/.env with your LLM endpoint

# 3. Build and start
docker compose -f docker/docker-compose.yml up -d --build

# 4. Open in browser
# → http://localhost:8080
```

> **First build** takes a few minutes (compiles Qwen C++ binary,
> installs Python deps, builds frontend). Subsequent runs reuse
> the cached image unless `--build` is passed.

## Engine Selection

Engines are configured in `docker/.env`.

### TTS (Text-to-Speech)

| `KALI_TTS_PROVIDER` | Engine | Voices |
|---|---|---|
| `inproc` | Piper (in-process) | glados-es, robot-es |
| `qwen3` | Qwen3-TTS | Neural voices |
| `http` | External Service | Varies |

### STT (Speech-to-Text)

| `KALI_STT_PROVIDER` | Engine | Status |
|---|---|---|
| `vosk` | Vosk (offline) | Available |

## GPU Support (CUDA)

GPU acceleration is only needed if you use **Qwen3-TTS** (`KALI_TTS_PROVIDER=qwen3`).
The default **Piper TTS** (`inproc`) runs fine on CPU.

To use GPU:

```bash
# 1. Build GPU image (includes both GPU and CPU fallback binaries)
docker build -f docker/Dockerfile.gpu -t kali:gpu .

# 2. Configure .env
#    KALI_TTS_PROVIDER=qwen3     ← enables Qwen3 TTS
#    KALI_QWEN_BACKEND=CUDA0     ← selects GPU backend

# 3. Start with GPU override
docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml up -d
```

The GPU image includes both the CUDA binary and a CPU fallback.
If no GPU is available, set `KALI_QWEN_BACKEND=CPU`.

## Microphone Access

The container requires access to the host's audio hardware:
- **ALSA**: `/dev/snd` is mounted.
- **PulseAudio**: `${XDG_RUNTIME_DIR}/pulse` socket is mounted.

## Persistence

| Volume | Container Path | Content |
|---|---|---|
| `kali-models` | `/app/models` | Downloaded TTS/STT models |
| `kali-data` | `/app/data` | SQLite sessions, configs, images |
