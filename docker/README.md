# Kali — Docker Deployment

Full deployment of Kali (kali-core + kali-web) in Docker, with support for multiple TTS/STT engines and GPU acceleration.

## Requirements

- **Docker 23+ with BuildKit** (default since Docker 23.x) — the GPU
  Dockerfiles use `RUN --mount=type=cache`, which **only works with
  BuildKit**. If a build fails with
  `the --mount option requires BuildKit` on a modern Docker (you are on the
  legacy builder), something is explicitly disabling it:
  - Check: `echo $DOCKER_BUILDKIT` — if it prints `0`, remove that export
    from your shell profile (`~/.zshrc` / `~/.bashrc` / `/etc/environment`)
    or force it to `1` per build: `DOCKER_BUILDKIT=1 docker build ...`
  - If `docker buildx version` says *unknown command*, the **buildx plugin
    is missing** (common with distro Docker packages): install it with
    `sudo apt-get install docker-buildx` (Ubuntu) or
    `docker-buildx-plugin` (official Docker repo). Without it, `docker
    build` falls back to the legacy builder even on a modern engine.
- **Docker Compose 2.x** (the `docker compose` plugin, not the legacy
  `docker-compose` binary)
- **nvidia-container-toolkit** (only for the GPU stacks) — driver 525+;
  verified with RTX 3060 / driver 595.x

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

> If startup fails with `could not select device driver "nvidia"`: the
> toolkit is missing or the daemon wasn't restarted. The toolkit is **not in
> the default Ubuntu/Debian repos** — add NVIDIA's repo first:
> ```bash
> curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
>   sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
> curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
>   sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
>   sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
> sudo apt-get update
> sudo apt-get install -y nvidia-container-toolkit
> sudo nvidia-ctk runtime configure --runtime=docker
> sudo systemctl restart docker
> ```

### 4) Dev GPU (HMR + CUDA) — for working on TTS/voice

> ⏱️ **First-run timing:** the full GPU-dev stack takes **~20-30 min on a
> fresh clone** (~10-15 min building the CUDA image, ~5-10 min installing
> the Python venv incl. torch for the ASR extra, then startup). Later
> runs start in seconds. During the first venv install nginx shows 502
> for the frontend — that's the Vite upstream not started yet, not a hang.

```bash
docker compose -f docker/docker-compose.yml \
               -f docker/docker-compose.gpu.dev.yml \
               -f docker/docker-compose.override.yml up -d --build
```

Same dev stack as (2) but on `Dockerfile.gpu.dev` (CUDA base + Node +
`tts-server` GPU binary baked in) with device reservations and
`KALI_TTS_PROVIDER=qwen3`, `KALI_QWEN_BACKEND=CUDA0`.

> **Note (GPU + dev):** in dev the TTS binaries run from the **bind-mounted
> source tree** (`kali_core/voice/qwen_cpp/{build,build-gpu}/tts-server`),
> not from the image. Those folders are gitignored — populating them from
> the image happens automatically at startup (see below); only if the image
> is too old to carry them, extract from the **builder stage**.
>
> ⚠️ **Two different images, two tags.** The image that RUNS the dev stack
> must always be built **without** `--target`:
> ```bash
> docker build -f docker/Dockerfile.gpu.dev -t kali:gpu-dev .   # ← the stack image
> ```
> `--target builder` produces a **parallel extraction-only image**
> (compile toolchain + artefacts, no entrypoint/Vite) — if you tag it as
> `kali:gpu-dev` the stack fails to start with
> `no such file or directory: /app/docker/entrypoint-dev.sh`.
> ```bash
> # extraction-only image (does NOT run the dev stack):
> docker build --target builder -f docker/Dockerfile.gpu.dev -t kali:gpu-dev-builder .
> ```
> From it you can manually copy binaries+libs if ever needed:
> ```bash
> CID=$(docker create kali:gpu-dev-builder)
> docker cp "$CID:/build/qwen-cpp/build-gpu/." kali-core/kali_core/voice/qwen_cpp/build-gpu/
> docker cp "$CID:/build/qwen-cpp/build/."     kali-core/kali_core/voice/qwen_cpp/build/
> docker rm "$CID"
> ```
> Alternatively run `scripts/build-qwen-cpp.sh cuda|cpu` inside a GPU-dev
> container (it has the CUDA dev toolchain in its builder stage).
> `providers/qwen.py` sets `LD_LIBRARY_PATH` to the binary's folder
> automatically (the `libggml*.so` live next to it).
> On a fresh clone none of this is manual: the dev launcher copies the
> binaries from the image on first `up`.

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

### Optional TLS (`KALI_TLS=true`) — microphone from remote browsers

Browsers only allow `getUserMedia` (the mic) in a **Secure Context**: plain
HTTP over LAN silently disables it. With TLS enabled, access from any device
via `https://<host-ip>:8444`, accept the self-signed certificate warning once
per browser, and voice input works (UI + `wss://`).

```bash
# docker/.env
KALI_TLS=true                                  # enable TLS (default false)
KALI_TLS_HOSTS=192.168.1.14,companion.local    # SANs of the self-signed cert
KALI_TLS_PORT=8444                             # default 8444
```

- At startup `tls-init.sh` generates a self-signed cert (idempotent; auto-regenerates < 30 days to expiry).
- nginx swaps its listener to `:8444 ssl` (HTTP :8080 stops — the UI is HTTPS-only while TLS is on).
- The cert is also served at `https://<ip>:8444/kali.crt` to import as a trusted CA (removes the warning; optional).
- Verified on a fresh clone: HTTPS `/health` ok, SANs correct, `wss://` handshake 101 over TLS.

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