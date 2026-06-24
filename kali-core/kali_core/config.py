"""Kali-core configuration.

Loads from env vars with typed defaults. Exposes a `settings` object
so the rest of the codebase does not touch `os.getenv` directly.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

load_dotenv()


def _env_bool(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).lower() in {"true", "1", "yes"}


# ── Server ────────────────────────────────────────────────
port: int = int(os.getenv("KALI_PORT", "8900"))
host: str = os.getenv("KALI_HOST", "0.0.0.0")

# ── LLM (kali-mind) ───────────────────────────────────────
llm_provider: Literal["direct", "nanobot"] = os.getenv(
    "KALI_LLM_PROVIDER", "direct"
)
llm_api_url: str = os.getenv("KALI_LLM_API_URL", "http://localhost:11434/v1")
llm_api_key: str = os.getenv("KALI_LLM_API_KEY", "")
llm_model: str = os.getenv("KALI_LLM_MODEL", "glm-5.1")
llm_system_prompt: str = os.getenv(
    "KALI_LLM_SYSTEM_PROMPT",
    (
        "You are Kali, a helpful desktop companion. Reply in the user's language.\n\n"
        "You have access to tools that can perform actions on the user's system.\n"
        "When the user's request matches a tool's purpose, call the tool to get\n"
        "accurate data instead of relying on your training data.\n\n"
        "Available tools:\n"
        "- fetch_game_resource: Look up ANY game character, hero, champion, item,\n"
        "  build, stats, abilities, review, or tip for ANY game. This is the ONLY\n"
        "  tool for game-related questions. Returns a visual card. Supports ALL games.\n"
        "- web_search: Search the web for current information (non-game topics).\n"
        "- web_fetch: Fetch content from a URL.\n"
        "- run_command: Run shell commands (use with caution).\n"
        "- fs_read / fs_list: Read files and list directories.\n"
        "- screenshot: Capture and describe the screen.\n"
        "- list_monitors: List the available monitors (outputs). Use it\n"
        "  BEFORE screenshot when the user has more than one monitor.\n"
        "- organize_folder: Organize files in a directory.\n"
        "- run_tests: Run test suites.\n"
        "- launch_app: Launch desktop applications.\n"
        "- git_worktree / git_diff: Git operations.\n\n"
        "MANDATORY RULE: For ANY question about a game character, hero, champion,\n"
        "item, build, stats, abilities, review, or tip, you MUST call\n"
        "fetch_game_resource. Do NOT use web_search or any other tool for these.\n"
        "fetch_game_resource works for ALL games. Pass the full user query as\n"
        "the 'query' parameter — the tool will figure out what the user wants.\n\n"
        "IMPORTANT: When a tool produces a visual card/artifact, the card\n"
        "is shown to the user as a floating window — it contains ALL the\n"
        "structured data (stats, abilities, builds, etc.). Your text\n"
        "response after the tool call must be COMPLEMENTARY, not a repeat.\n\n"
        "ARTEFACT RULE:\n"
        "- GOOD: 'Pudge es un iniciador brutal. Combina Meat Hook con Dismember\n"
        "  para atrapar y eliminar objetivos aislados. Su win rate baja en late\n"
        "  game, así que capitaliza el early.'\n"
        "- GOOD: 'Ahí tienes a Ahri. Un tip: su E (Charm) es clave para el\n"
        "  combo — siempre úsalo antes de la Q para asegurar el burst.'\n"
        "- BAD: 'Pudge es un héroe de fuerza con 620 de vida, 267 de mana...'\n"
        "  (this repeats stats that are already in the card)\n"
        "- BAD: 'Las habilidades de Pudge son Meat Hook, Rot, Dismember...'\n"
        "  (this repeats what the card already shows)\n\n"
        "Keep your complementary response to 1-3 sentences. Add insight,\n"
        "strategy, context, or ask a follow-up question. NEVER repeat data\n"
        "from the card. If the tool returns an error or no results, explain\n"
        "that to the user.\n\n"
        "When NO artifact is produced (e.g. web_search, run_command,\n"
        "fs_read), respond normally with a full text answer.\n\n"
        "After ANY tool call, you MUST provide a text response. Never leave\n"
        "the user without a response.\n\n"
        "Examples:\n"
        'User: "Whats Pudge build?"\n'
        '→ call fetch_game_resource with {"game": "Dota 2", "query": "Pudge build"}\n\n'
        'User: "Ahri build League of Legends"\n'
        '→ call fetch_game_resource with {"game": "League of Legends", "query": "Ahri build"}\n\n'
        'User: "Nemesis Resident Evil"\n'
        '→ call fetch_game_resource with {"game": "Resident Evil", "query": "Nemesis"}\n\n'
        'User: "Whats the weather?"\n'
        "→ call web_search.\n\n"
        "When in doubt, prefer the most specific tool.\n\n"
        "STT NOTE: The user speaks to you via speech-to-text, which sometimes\n"
        "mishears English words used within Spanish speech. If the conversation\n"
        "context strongly suggests a word was mis-transcribed, interpret what\n"
        "the user likely meant and respond as if they said the correct word.\n"
        "Only correct when context clearly supports it — do not guess randomly.\n"
        "\n"
        "SCREENSHOT / MONITOR PROCEDURE (mandatory when the user has multiple\n"
        "monitors, or when you are about to take a screenshot for the first time\n"
        "in the session):\n"
        "1. Call list_monitors to enumerate the outputs. Report each one by\n"
        "   index, name and resolution, and name a primary_guess.\n"
        "2. For each monitor you are unsure about, call screenshot with\n"
        "   {\"monitor\": \"<name>\", \"sample\": true, \"reason\": \"identify which\n"
        "   monitor is which\"}. Describe what you see and confirm with the user\n"
        "   which monitor is the PRIMARY (the one they work/game on) and which\n"
        "   is SECONDARY. Remember this mapping for the rest of the session.\n"
        "3. For subsequent screenshots, accept 'primary' (default), 'secondary',\n"
        "   or the output name as the `monitor` parameter. If the user does not\n"
        "   specify, use primary. If the user is running a game and asks for a\n"
        "   capture without specifying, assume the primary monitor.\n"
        "4. Always pass a short `reason` to screenshot so the consent modal can\n"
        "   tell the user why you want to see the screen (e.g. 'verify the game\n"
        "   is running', 'check the error dialog').\n"
        "5. The captured PNG is saved to ~/.local/share/kali/snapshots/ — you can\n"
        "   mention the path to the user so they can review it.\n"
    ),
)

# nanobot (optional)
nanobot_ws_url: str = os.getenv("KALI_NANOBOT_WS_URL", "ws://127.0.0.1:8765")
nanobot_api_url: str = os.getenv("KALI_NANOBOT_API_URL", "http://127.0.0.1:8765")
nanobot_token: str = os.getenv("KALI_NANOBOT_TOKEN", "")

# ── TTS (kali-voice) ───────────────────────────────────────
tts_provider: Literal["inproc", "http"] = os.getenv("KALI_TTS_PROVIDER", "inproc")
tts_voice: str = os.getenv("KALI_TTS_VOICE", "glados-es")
tts_mode: str = os.getenv("KALI_TTS_MODE", "normal")
tts_max_length: int = int(os.getenv("KALI_TTS_MAX_LENGTH", "2000"))
tts_http_url: str = os.getenv("KALI_TTS_HTTP_URL", "http://localhost:3000")
tts_enabled: bool = _env_bool("KALI_TTS_ENABLED", True)

# ── STT (kali-ear) ────────────────────────────────────────
stt_model: str = os.getenv("KALI_STT_MODEL", "vosk-model-small-es-0.42")
stt_model_en: str = os.getenv("KALI_STT_MODEL_EN", "vosk-model-small-en-us-0.15")
stt_language: str = os.getenv("KALI_STT_LANGUAGE", "es")
stt_wake_word_enabled: bool = _env_bool("KALI_STT_WAKE_WORD", False)
stt_wake_word_threshold: float = float(os.getenv("KALI_STT_WAKE_WORD_THRESHOLD", "0.3"))
stt_wake_word_cooldown: float = float(os.getenv("KALI_STT_WAKE_WORD_COOLDOWN", "2.0"))
input_mode: str = os.getenv("KALI_INPUT_MODE", "wake_word")

# ── Web tools (kali-claws) ────────────────────────────────
searxng_url: str = os.getenv("KALI_SEARXNG_URL", "http://127.0.0.1:8080")

# ── Vision / Gaze (kali-gaze) ──────────────────────────────
vision_mode: str = os.getenv("KALI_VISION_MODE", "auto")
kali_home_ipc_port: int = int(os.getenv("KALI_HOME_IPC_PORT", "8901"))

# ── Permissions (kali-collar) ──────────────────────────────
active_profile: str = os.getenv("KALI_PROFILE", "dev")

# ── Paths ─────────────────────────────────────────────────
data_dir = Path.home() / ".local" / "share" / "kali"
db_path: str = str(data_dir / "kali.db")
images_dir: str = str(data_dir / "images")
snapshots_dir: str = str(data_dir / "snapshots")
base_dir = Path(__file__).resolve().parent
voices_dir = base_dir / "voice" / "voices"
voice_configs_dir = base_dir / "voice" / "voice_configs"
stt_models_dir = base_dir / "ear" / "models"
profiles_dir = base_dir / "collar" / "profiles"


class _Settings:
    """Bag object so consumers can import a single `settings`."""

    port = port
    host = host

    llm_provider = llm_provider
    llm_api_url = llm_api_url
    llm_api_key = llm_api_key
    llm_model = llm_model
    llm_system_prompt = llm_system_prompt

    nanobot_ws_url = nanobot_ws_url
    nanobot_api_url = nanobot_api_url
    nanobot_token = nanobot_token

    tts_provider = tts_provider
    tts_voice = tts_voice
    tts_mode = tts_mode
    tts_max_length = tts_max_length
    tts_http_url = tts_http_url
    tts_enabled = tts_enabled

    stt_model = stt_model
    stt_model_en = stt_model_en
    stt_language = stt_language
    stt_wake_word_enabled = stt_wake_word_enabled
    stt_wake_word_threshold = stt_wake_word_threshold
    stt_wake_word_cooldown = stt_wake_word_cooldown
    input_mode = input_mode

    vision_mode = vision_mode
    kali_home_ipc_port = kali_home_ipc_port

    active_profile = active_profile

    searxng_url = searxng_url

    db_path = db_path
    images_dir = images_dir
    snapshots_dir = snapshots_dir

    voices_dir = voices_dir
    voice_configs_dir = voice_configs_dir
    stt_models_dir = stt_models_dir
    profiles_dir = profiles_dir


settings = _Settings()