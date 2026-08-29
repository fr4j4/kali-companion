# Kali — Docker Deployment

Full deployment of Kali (kali-core + kali-web) in Docker, with support for multiple TTS/STT engines and GPU acceleration.

## The four stacks (all verified)

| Stack | Image | Compose files | Use for |
|---|---|---|---|
| **Prod CPU** | `kali:latest` | base | Running Kali normally (Piper TTS on CPU) |
| **Prod GPU** | `kali:gpu` | base + `gpu.yml` | Production with Qwen3-TTS on CUDA |
| **Dev CPU** | `kali-dev` | base + `override.yml` | Developing with HMR + hot reload |
| **Dev GPU** | `kali:gpu-dev` | base + `override.yml` + `gpu.dev.yml` | Developing **and** testing TTS on GPU |

One name/tag per variant — overlays pin their own `image:` so a rebuild in
one stack can never overwrite another stack's image. Overlay order matters:
`override.yml` (pins `kali-dev`) must come **before** `gpu.dev.yml` (pins
`kali:gpu-dev`) in the `-f` sequence.

### 1) Prod CPU (default)

```bash
cp docker/.env.example docker/.env   # set KALI_LLM_API_URL / MODEL / API_KEY
docker compose -f docker/docker-compose.yml up -d --build
```

- nginx serves the prebuilt frontend (`kali-web/dist` baked into the image)
- kali-core on uvicorn (no reload), entrypoint: `/app/entrypoint.sh`

### 2) Dev CPU (HMR) — daily driver

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d --build
```

What the dev stack adds:

| Piece | Role |
|---|---|
| `entrypoint-dev.sh` | Assembles nginx (main + dev conf, http{} left open), validates with `nginx -t`, then hands off to the dev launcher |
| `dev-in-docker.sh` | Creates the Python venv **automatically**, installs deps, starts uvicorn `--reload` (:8900) + Vite dev (:5173), supervises both |
| Bind mounts | `kali-core/` and `kali-web/` mounted into the container → edit on the host, reload happens in-container |

URLs (from `docker/.env`): frontend `http://localhost:${KALI_WEB_PORT}` →
nginx → Vite; API/WS `http://localhost:${KALI_PORT}`. On this machine:
**8081** (8080 is taken by searxng) and **8900**. HMR works from LAN via
`companion.local` (Vite `allowedHosts` is preconfigured).

### 3) Prod GPU (Qwen3-TTS on CUDA)

```bash
# 1. Build the GPU image (one-time; includes CUDA binary + CPU fallback)
docker build -f docker/Dockerfile.gpu -t kali:gpu .

# 2. Configure .env
#    KALI_TTS_PROVIDER=qwen3
#    KALI_QWEN_BACKEND=CUDA0

# 3. Start
docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml up -d
```

Requires `nvidia-container-toolkit` on the host. Verify inside the container:
`docker exec kali nvidia-smi`.

### 4) Dev GPU (HMR + CUDA) — for working on TTS/voice

```bash
docker compose -f docker/docker-compose.yml \
               -f docker/docker-compose.gpu.dev.yml \
               -f docker/docker-compose.override.yml up -d --build
```

Same dev stack as (2) but on `Dockerfile.gpu.dev` (CUDA base + Node +
`tts-server` GPU binary baked in) with device reservations and
`KALI_TTS_PROVIDER=qwen3`, `KALI_QWEN_BACKEND=CUDA0`.

> **Note (GPU + dev):** in dev the TTS binary runs from the **bind-mounted
> source tree** (`kali_core/voice/qwen_cpp/build-gpu/`), not from the image.
> That folder is gitignored — if it's missing, extract it from the image's
> builder stage:
> ```bash
> CID=$(docker create kali:gpu-dev)
> docker cp "$CID:/app/qwen-cpp/build-gpu/." kali-core/kali_core/voice/qwen_cpp/build-gpu/
> docker rm "$CID"
> ```
> `providers/qwen.py` sets `LD_LIBRARY_PATH` to the binary's folder
> automatically (the `libggml*.so` live next to it).

## Engines (TTS / STT)

> **How defaults work:** the `.env`/image only set the *starting* provider
> (Piper + Vosk on CPU — fully offline). The **real choice is made in the
> UI** (Settings → Voice): switch provider (Piper/Qwen3/HTTP) and pick the
> device (CPU / CUDA0…) from the hardware actually available in the
> container. That choice is **persisted** in `user_config.json` and survives
> restarts — afterwards it takes precedence over `KALI_*` env vars.
> The image defines the *ceiling*: in `kali:latest`/`kali-dev` only CPU is
> visible; the `kali:gpu*` images expose CUDA devices in the UI.

### TTS (`KALI_TTS_PROVIDER`)

| Value | Engine | Notes |
|---|---|---|
| `inproc` (default) | Piper, in-process | Local, CPU, voices in `/app/models/piper-voices` |
| `qwen3` | Qwen3-TTS C++ server | Needs the GPU stack (prod `kali:gpu` / dev `kali:gpu-dev`); spawns `tts-server` on :8870 |
| `qwen3-voicedesign` | Qwen3-TTS VoiceDesign | Custom voice cloning (1.7B model), same GPU requirements |
| `http` | External OpenAI-compatible TTS | Point it at `KALI_TTS_HTTP_URL` service |

### STT (`KALI_STT_PROVIDER`)

| Value | Engine | Notes |
|---|---|---|
| `vosk` (default) | Vosk, fully offline | Models in `/app/models/vosk/` |
| `qwen3` | Qwen3-ASR | GPU-only, shares the Qwen C++ server stack |

## Microphone & audio

The container needs host audio hardware:
- **ALSA**: `/dev/snd` device mount (dev stack)
- **PulseAudio**: `${XDG_RUNTIME_DIR}/pulse` socket (both stacks)
- On this host, user 1000 owns the socket; the container runs as UID 1000
  (`kali` user), so it matches without extra config.

## Python venvs in dev (per flavor, automatic)

The repo is bind-mounted into containers with **different bases** (host, CPU
container = Debian, GPU container = Ubuntu+CUDA). A single shared venv breaks
when you switch bases (dead python symlinks, broken pip). `dev-in-docker.sh`
therefore uses **one venv per flavor**, created automatically on first run:

```
kali-core/.venv-cpu/   # used by the CPU dev container
kali-core/.venv-gpu/   # used by the GPU dev container
```

- Not needed for prod (the image has its own interpreter + packages).
- Both are gitignored. If missing **or** broken for the current environment
  (functional check: `uvicorn` importable), they are rebuilt from scratch —
  no manual steps.
- For host-side tests use a venv **outside** the repo (e.g.
  `~/.venvs/kali-companion`) to avoid poisoning the bind mount.

## Ports & environment

| Port | Purpose | Config |
|---|---|---|
| `${KALI_PORT:-8900}` | kali-core WebSocket + HTTP API | `docker/.env` |
| `${KALI_WEB_PORT:-8080}` | nginx → frontend (Vite in dev) | `docker/.env` |
| 8870 (container-internal) | Qwen3-TTS C++ server (only when provider = qwen3) | `KALI_QWEN_PORT` |

Important `.env` keys: `KALI_LLM_API_URL`, `KALI_LLM_API_KEY`,
`KALI_LLM_MODEL` (**currently empty → chat/LLM features disabled**),
`KALI_TTS_PROVIDER`, `KALI_STT_PROVIDER`, `KALI_QWEN_BACKEND`,
`KALI_PROFILE` (`dev` whitelist used by permissions).

> `container_name: kali` is fixed — only one Kali container can run at a
> time. When switching stacks: `docker compose -p docker ... down` first.

## Persistence

Absolute bind mounts (this machine's layout; adjust in
`docker/docker-compose.yml` if deploying elsewhere):

| Host | Container | Content |
|---|---|---|
| `/mnt/data2/data` | `/app/data` | SQLite sessions, `ai_config.json`, snapshots |
| `/mnt/data2/models/voice` | `/app/models` | Piper `.onnx`, Vosk models, Qwen3 `.gguf` |
| `/mnt/data2/audio` | `/app/audio` | TTS render cache, STT recordings |
| `/mnt/data2/logs` | `/app/logs` | Container logs |
| `/mnt/data2/cache` | `/app/.cache` | pip / HF downloads cache |

## Health checks & first-run

- `GET :${KALI_PORT}/health` → `{"status":"ok","version":"0.1.0"}`; the
  compose healthcheck drives ` docker ps` status (wait for `healthy`).
- Models: Qwen3 `.gguf` auto-downloads on first `qwen3` start; Vosk lives in
  the models bind (`/app/models/vosk/vosk-model-small-es-0.42`).
- If the container restarts in a loop: `docker logs kali` — the dev
  entrypoint prints the exact failing step (nginx assembly, venv, Vite).