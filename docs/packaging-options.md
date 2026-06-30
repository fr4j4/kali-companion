# Kali — Packaging and Distribution Options

## Current Status

| Format | Status |
|---|---|
| **Docker** | Complete and functional (`docker/Dockerfile`, `docker/Dockerfile.gpu`) |
| **Electron (AppImage/deb)** | Partial — `kali-shell/electron-builder.yml` defines targets but currently only bundles the Electron shell |
| **pip install** | Working — `kali-core` is a valid Python package with `pyproject.toml` (hatchling) |
| **Snap/Flatpak** | Not started |

## System Components

- **kali-core**: Python backend (FastAPI + WebSocket). Entry point: `python -m kali_core`
- **kali-web**: React frontend (Vite). Build: `npm run build` → `dist/`
- **kali-shell**: Electron shell (optional desktop mode)
- **qwen-cpp/tts-server**: C++ binary for Qwen3 TTS (CPU/GPU)
- **Models**: Vosk STT (~85 MB), Piper voices (~25 MB), Qwen3 GGUF (~1-2 GB)

## Recommended Options

**Option 1: Docker (Standard)**
- Portable and consistent across Linux systems.
- GPU support included via `Dockerfile.gpu`.

**Option 2: pip + systemd (Native)**
- `pip install kali-core`
- Clean system integration but requires Python 3.12+ on the host.

## System Dependencies (Runtime)

| Dependency | Purpose |
|---|---|
| Python 3.12+ | kali-core runtime |
| libasound2 | Audio access (mic + speakers) |
| libpulse0 | PulseAudio support |
| curl / wget | Model downloads (first run) |
