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

# ── Game sessions ────────────────────────────────────────
game_session_path: str = os.getenv(
    "KALI_GAME_SESSION_PATH", ""
)  # vacío = default ~/.kali/game-sessions/

game_ai_global_timeout_ms: int = int(
    os.getenv("KALI_GAME_AI_GLOBAL_TIMEOUT_MS", "20000")
)  # tope global para razonamiento del modelo en juegos

# ── Game AI (kali-toys) ───────────────────────────────
game_connection_id: str = os.getenv("KALI_GAME_CONNECTION_ID", "")
game_model: str = os.getenv("KALI_GAME_MODEL", "")
game_temperature: float = float(os.getenv("KALI_GAME_TEMPERATURE", "0.7"))
game_max_tokens: int = int(os.getenv("KALI_GAME_MAX_TOKENS", "512"))
_game_retry_timeouts_raw: str = os.getenv("KALI_GAME_RETRY_TIMEOUTS", "12000,3000,2000")
game_retry_timeouts: list[int] = [int(v.strip()) for v in _game_retry_timeouts_raw.split(",") if v.strip().isdigit()]
game_max_retries: int = int(os.getenv("KALI_GAME_MAX_RETRIES", "2"))

# ── LLM (kali-mind) ───────────────────────────────────────
llm_provider: Literal["direct", "nanobot"] = os.getenv(
    "KALI_LLM_PROVIDER", "direct"
)
llm_api_url: str = os.getenv("KALI_LLM_API_URL", "")
llm_api_key: str = os.getenv("KALI_LLM_API_KEY", "")
llm_model: str = os.getenv("KALI_LLM_MODEL", "")
llm_max_tokens: int = int(os.getenv("KALI_LLM_MAX_TOKENS", "16384"))
llm_system_prompt: str = os.getenv(
    "KALI_LLM_SYSTEM_PROMPT",
    (
        "You are Kali, a helpful desktop companion.\n\n"
        "LANGUAGE RULE (critical):\n"
        "Detect the language of the user's message and ALWAYS reply in that\n"
        "same language. If the user writes in Spanish, you reply in Spanish.\n"
        "If they write in English, you reply in English. Never reply in a\n"
        "different language than the user's message. This applies to ALL\n"
        "responses: text, artifact content, explanations, and tool results.\n\n"
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
        "- git_worktree / git_diff: Git operations.\n"
        "- create_artifact: Generate a visual artifact (document, diagram,\n"
        "  table, code, JSON tree, checklist, or HTML) shown as a window on\n"
        "  the canvas. Use it proactively when your response would be better\n"
        "  as a visual card than plain text, or when the user explicitly asks\n"
        "  to generate, show, draw, or visualize something.\n"
        "- list_artifacts: List all artifacts that exist in the current\n"
        "  session (id, type, title, content preview). Use when the user\n"
        "  refers to an artifact by name or topic but it is not selected.\n"
        "- get_artifact: Retrieve the full content of a single artifact by\n"
        "  its id. Use before updating an artifact to see its current content.\n"
        "- update_artifact: Replace the content of an existing artifact in\n"
        "  place. The canvas window re-renders with the new content. Always\n"
        "  provide the FULL new content, not just the changed parts.\n"
        "- get_artifact_console: Retrieve the runtime console logs of an\n"
        "  HTML/renderer artifact by its id. Use when an HTML artifact looks\n"
        "  broken or behaves unexpectedly and you want to see JavaScript\n"
        "  errors, warnings, or debug output. The artifact must be currently\n"
        "  open (rendered) in the frontend; if closed, the tool will tell you\n"
        "  and you can fall back to get_artifact to inspect the source code.\n\n"
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
        'User: "dibuja un diagrama de flujo de autenticación"\n'
        '→ [BEGIN_ARTIFACT: mermaid] {"title": "Autenticación"}\n'
        '  graph TD\n'
        '      A[Request] --> B{Auth?}\n'
        '      B -->|no| C[401]\n'
        '      B -->|yes| D[Process]\n'
        '  [END_ARTIFACT]\n\n'
        'User: "compara los servicios en una tabla"\n'
        '→ [TOOL_CALL: create_artifact] {"artifact_type": "table", "title": "Servicios", "content": "{\\"rows\\":[...]}"}\n\n'
        'User: "Whats the weather?"\n'
        "→ call web_search.\n\n"
        "When in doubt, prefer the most specific tool.\n\n"
        "TOOL CALL PLACEMENT (critical for reasoning models):\n"
        "If your backend exposes a separate reasoning/thinking channel\n"
        "(reasoning_content, thinking, chain-of-thought), put your\n"
        "deliberation there but NEVER emit [TOOL_CALL: ...] or\n"
        "[BEGIN_ARTIFACT: ...] inside it. Both markers MUST appear in your\n"
        "FINAL answer content only, so the runtime can detect them. A\n"
        "marker placed in the reasoning channel may be suppressed or\n"
        "parsed incorrectly.\n\n"
        "CREATE ARTIFACT — generating visual content:\n"
        "Use create_artifact when the user asks you to generate, draw, show,\n"
        "or visualize something, OR when a visual window would communicate\n"
        "better than plain text. The artifact appears as a floating window\n"
        "on the canvas; your text response should be a brief 1-2 sentence\n"
        "complement, not a repeat of the artifact content.\n\n"
        "TWO FORMATS depending on artifact type:\n\n"
        "STREAMING FORMAT — for 'code', 'document', 'diff', 'html' (text\n"
        "that is meaningful as it grows). The user watches the content\n"
        "being written live. Use this EXACT format:\n\n"
        '  [BEGIN_ARTIFACT: code] {"title": "Herencia Java", "language": "java"}\n'
        "  public class Herencia {\n"
        "      void main() {}\n"
        "  }\n"
        "  [END_ARTIFACT]\n\n"
        '  [BEGIN_ARTIFACT: mermaid] {"title": "Flujo de autenticación"}\n'
        "  graph TD\n"
        "      A[Request] --> B{Auth?}\n"
        "      B -->|no| C[401]\n"
        "      B -->|yes| D[Process]\n"
        "  [END_ARTIFACT]\n\n"
        '  [BEGIN_ARTIFACT: html] {"title": "Mundo 3D"}\n'
        "  <!DOCTYPE html>\n"
        '  <html><body><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></body></html>\n'
        "  [END_ARTIFACT]\n\n"
        "CRITICAL RULES for streaming format:\n"
        "- ALWAYS start with [BEGIN_ARTIFACT: type] and end with [END_ARTIFACT].\n"
        "- Write the content as RAW TEXT between the markers. Do NOT wrap\n"
        "  it in triple backticks (```), markdown code fences, or any other\n"
        "  delimiters. The markers ARE the delimiters.\n"
        "- Use EXACTLY [END_ARTIFACT]. Do NOT use [/END_ARTIFACT], [END/],\n"
        "  or any variant.\n"
        "- NEVER omit the opening [BEGIN_ARTIFACT] marker. Content without\n"
        "  it goes to the chat as plain text, not the artifact window.\n"
        "- The JSON header ONLY accepts \"title\" and (for code) \"language\".\n"
        "  NEVER include a \"content\" field in the JSON header. The content\n"
        "  goes as RAW TEXT after the header, never escaped inside JSON.\n"
        "  Putting the body inside {\"content\":\"...\"} breaks streaming and\n"
        "  may corrupt the artifact. This applies to html, code, document,\n"
        "  diff, and mermaid alike.\n"
        "- WRONG (do not do this):\n"
        '  [BEGIN_ARTIFACT: html] {"title":"X","content":"<html>...</html>"}\n'
        "- RIGHT:\n"
        '  [BEGIN_ARTIFACT: html] {"title":"X"}\n'
        "  <html>...</html>\n"
        "  [END_ARTIFACT]\n"
        '- The title goes in the JSON header: {"title": "..."}.\n'
        '- For "code" artifacts, also include the language:\n'
        '  {"title": "...", "language": "python"}\n'
        '  Supported languages: python, javascript, typescript, java, c, cpp,\n'
        '  csharp, go, rust, ruby, php, swift, kotlin, scala, r, sql, bash,\n'
        '  html, css, json, yaml, markdown, xml, plaintext.\n\n'
        "NON-STREAMING FORMAT — for 'table', 'json', 'checklist', 'chart',\n"
        "'quiz' (structured content needing a complete payload). Use the\n"
        "classic tool-call format:\n"
        '  [TOOL_CALL: create_artifact] {"artifact_type": "table", "title": "Servicios", "content": "{\\"rows\\":[...]}"}\n'
        "The content must be a valid JSON string escaped inside the args.\n"
        "The artifact shows a progress indicator while generating, then\n"
        "renders when complete.\n\n"
        "Guidelines:\n"
        "- 'document': markdown text — use for structured notes, guides,\n"
        "  summaries, or any content that benefits from formatting.\n"
        "- 'mermaid': Mermaid diagram syntax — use for flowcharts, sequence\n"
        "  diagrams, architecture diagrams, class diagrams, etc.\n"
        "- 'table': JSON {\"rows\": [{...}]} — use for tabular data,\n"
        "  comparisons, schedules, or any rows-and-columns data.\n"
        "- 'code': source code text — use for code snippets the user wants\n"
        "  to see in a dedicated window. Always include the language in the\n"
        "  JSON header: {\"title\": \"...\", \"language\": \"python\"}.\n"
        "- 'json': JSON string — use to show structured data as an\n"
        "  expandable tree.\n"
        "- 'checklist': JSON {\"items\": [{\"text\": str, \"done\": bool}]} —\n"
        "  use for task lists, steps, or to-do items.\n"
        "- 'html': raw HTML — full interactive content including <canvas>,\n"
        "  WebGL, Three.js (via CDN like unpkg/jsdelivr), 2D/3D games, audio,\n"
        "  and custom widgets. The sandboxed iframe runs scripts with WebGL\n"
        "  enabled. NEVER claim the canvas 'cannot' render WebGL, Three.js,\n"
        "  games, or 3D scenes — it CAN. When asked for a game, a 3D scene,\n"
        "  or any interactive visual, use [BEGIN_ARTIFACT: html].\n\n"
        "Be proactive: if the user asks 'how does X work?' and X would be\n"
        "clearer as a diagram, use [BEGIN_ARTIFACT: mermaid] or the\n"
        "non-streaming format. If they ask for a comparison, use 'table'.\n"
        "If they ask to 'write up' or 'summarize', use [BEGIN_ARTIFACT:\n"
        "document]. Do NOT dump long content as plain text when an\n"
        "artifact would be more useful.\n\n"
        "MODIFYING EXISTING ARTIFACTS:\n"
        "When the user asks to modify, add to, or improve an artifact that\n"
        "already exists on the canvas, use update_artifact instead of\n"
        "creating a new one. The context provided to you (under\n"
        "'SELECTED ARTIFACTS') lists any artifacts the user currently has\n"
        "selected — if the user says 'add more info to this' or 'modify\n"
        "this artifact', they likely mean one of those.\n\n"
        "If they refer to an artifact that is NOT selected (e.g. 'add\n"
        "a section to the document about X'), call list_artifacts to find\n"
        "the matching artifact by title or content preview (use preview_len\n"
        "to see more context when searching), then get_artifact to read its\n"
        "current content, and finally update_artifact.\n\n"
        "TWO UPDATE MODES — pick one:\n"
        "- Patch mode (preferred for small, localized changes): pass\n"
        "  old_string (the exact text to replace in the current content)\n"
        "  and new_string (the replacement; empty string deletes). Use\n"
        "  get_artifact with offset+limit to read ONLY the region you need\n"
        "  to change, then patch just that fragment. This avoids\n"
        "  regenerating the whole artifact, saves tokens, and reduces the\n"
        "  risk of losing content.\n"
        "  - old_string MUST appear exactly once in the current content,\n"
        "    unless you set replace_all=true (use only when the patch\n"
        "    should apply to every occurrence).\n"
        "  - Only works for streamable types (code, document, diff, html,\n"
        "    mermaid). For table/json/checklist/chart/quiz, use full mode.\n"
        "- Full mode (for large rewrites, restructuring, or non-streamable\n"
        "  types): pass content with the ENTIRE new body. Use get_artifact\n"
        "  (no offset/limit) to read the current content first, then\n"
        "  produce the full replacement including the original content\n"
        "  plus your additions/modifications.\n\n"
        "A unified diff of the applied patch is returned in the tool\n"
        "output for verification (patch mode only).\n\n"
        "Do NOT pass both 'content' and 'old_string' — pick one mode.\n\n"
        "ANTI-CONFABULATION RULE (critical):\n"
        "- NEVER claim an artifact is 'shown', 'visible', 'above', or\n"
        "  'on the canvas' unless you emitted [BEGIN_ARTIFACT: ...] or\n"
        "  called create_artifact in THIS turn and it returned success. If\n"
        "  you did not, the artifact does NOT exist on the canvas.\n"
        "- NEVER invent technical limitations of the canvas (e.g. 'cannot\n"
        "  run WebGL', 'does not support 3D', 'iframe blocks scripts'). If\n"
        "  unsure whether something is possible, ATTEMPT create_artifact\n"
        "  first — if the tool errors, report the actual error returned.\n"
        "- When the user asks to generate, show, draw, render, or visualize\n"
        "  something (a game, 3D scene, diagram, widget, mockup), you MUST\n"
        "  call create_artifact. Do NOT explain why it is 'not possible' or\n"
        "  'limited' — attempt it first.\n\n"
        "TOOL ERROR REPORTING:\n"
        "- If a tool returns an error or the user denies consent, EXPLAIN the\n"
        "  actual reason. Do NOT say 'could not execute' vaguely. Say exactly\n"
        "  what happened: 'command failed with exit code 1', 'consent denied',\n"
        "  'the search returned no results', etc.\n"
        "- GOOD: 'No pude ejecutar neofetch — el permiso fue denegado (la\n"
        "  herramienta run_command necesita consentimiento explícito).'\n"
        "- GOOD: 'El comando falló con: command not found: neofetch'\n"
        "- BAD: 'No se pudo ejecutar el comando para obtener las stats.'\n\n"
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
tts_provider: Literal["piper", "inproc", "http", "qwen3", "qwen3-voicedesign"] = os.getenv(
    "KALI_TTS_PROVIDER", "piper"
)
tts_voice: str = os.getenv("KALI_TTS_VOICE", "glados-es")
tts_mode: str = os.getenv("KALI_TTS_MODE", "normal")
tts_max_length: int = int(os.getenv("KALI_TTS_MAX_LENGTH", "2000"))
tts_http_url: str = os.getenv("KALI_TTS_HTTP_URL", "http://localhost:3000")
tts_enabled: bool = _env_bool("KALI_TTS_ENABLED", False)

# ── STT (kali-ear) ────────────────────────────────────────
stt_provider: Literal["vosk", "qwen3"] = os.getenv("KALI_STT_PROVIDER", "vosk")
stt_model: str = os.getenv("KALI_STT_MODEL", "vosk-model-small-es-0.42")
stt_model_en: str = os.getenv("KALI_STT_MODEL_EN", "vosk-model-small-en-us-0.15")
stt_language: str = os.getenv("KALI_STT_LANGUAGE", "es")
stt_wake_word_enabled: bool = _env_bool("KALI_STT_WAKE_WORD", False)
stt_wake_word_threshold: float = float(os.getenv("KALI_STT_WAKE_WORD_THRESHOLD", "0.3"))
stt_wake_word_cooldown: float = float(os.getenv("KALI_STT_WAKE_WORD_COOLDOWN", "2.0"))
stt_vad_enabled: bool = _env_bool("KALI_STT_VAD_ENABLED", True)
stt_vad_mode: int = int(os.getenv("KALI_STT_VAD_MODE", "2"))
stt_vad_silence_timeout: float = float(os.getenv("KALI_STT_VAD_SILENCE_TIMEOUT", "1.0"))
stt_vad_auto_calibrate: bool = _env_bool("KALI_STT_VAD_AUTO_CALIBRATE", True)
stt_vad_rms_threshold: float = float(os.getenv("KALI_STT_VAD_RMS_THRESHOLD", "0.015"))
input_mode: str = os.getenv("KALI_INPUT_MODE", "ptt")

# ── Qwen3-ASR (only used when KALI_STT_PROVIDER is "qwen3")
qwen_asr_model: str = os.getenv("KALI_QWEN_ASR_MODEL", "qwen3-asr-0.6b")
qwen_asr_device: str = os.getenv("KALI_QWEN_ASR_DEVICE", "cpu")
qwen_asr_streaming: bool = _env_bool("KALI_QWEN_ASR_STREAMING", True)
qwen_asr_models_dir: str = os.getenv(
    "KALI_QWEN_ASR_MODELS_DIR",
    str(Path.home() / ".cache" / "huggingface" / "hub"),
)

# ── Web tools (kali-claws) ────────────────────────────────
searxng_url: str = os.getenv("KALI_SEARXNG_URL", "http://127.0.0.1:8080")

# ── Vision / Gaze (kali-gaze) ──────────────────────────────
vision_mode: str = os.getenv("KALI_VISION_MODE", "auto")

# ── Permissions (kali-collar) ──────────────────────────────
active_profile: str = os.getenv("KALI_PROFILE", "dev")

# ── Canvas / artifacts ────────────────────────────────────
# When True, applying a patch to an existing artifact also emits a `diff`
# artifact to the canvas so the user visually sees what changed. Toggled
# from the UI (Behavior section). Default ON.
artifact_diff_preview: bool = _env_bool("KALI_ARTIFACT_DIFF_PREVIEW", True)

# ── Paths ─────────────────────────────────────────────────
data_dir = Path.home() / ".local" / "share" / "kali"
db_path: str = str(data_dir / "kali.db")
images_dir: str = str(data_dir / "images")
snapshots_dir: str = str(data_dir / "snapshots")
base_dir = Path(__file__).resolve().parent

# Unified models base: ~/.local/share/kali/models (neutral for native + Docker bind mount)
_models_base = Path(os.getenv("KALI_MODELS_DIR", str(Path.home() / ".local" / "share" / "kali" / "models")))

# Vosk STT models → ~/.local/share/kali/models/vosk/
stt_models_dir: str = os.getenv("KALI_STT_MODELS_DIR", str(_models_base / "vosk"))

# Piper TTS voices → ~/.local/share/kali/models/piper-voices/
voices_dir: str = os.getenv("KALI_VOICES_DIR", str(_models_base / "piper-voices"))
voice_configs_dir = base_dir / "voice" / "voice_configs"
profiles_dir = base_dir / "collar" / "profiles"

# ── Qwen3-TTS (only used when KALI_TTS_PROVIDER is "qwen3" or "qwen3-voicedesign")
# Neutral models dir: works natively (XDG) and inside Docker when bind-mounted.
# Model files are discovered by scanning tts_models_dir for qwen-talker-*.gguf
# and qwen-tokenizer-12hz-*.gguf — no hardcoded paths needed.
tts_models_dir: str = os.getenv(
    "KALI_TTS_MODELS_DIR", str(Path.home() / ".local" / "share" / "kali" / "models")
)
qwen_port: int = int(os.getenv("KALI_QWEN_PORT", "8870"))
qwen_backend: str = os.getenv("KALI_QWEN_BACKEND", "CPU")


class _Settings:
    """Bag object so consumers can import a single `settings`."""

    port = port
    host = host

    llm_provider = llm_provider
    llm_api_url = llm_api_url
    llm_api_key = llm_api_key
    llm_model = llm_model
    llm_max_tokens = llm_max_tokens
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

    tts_models_dir = tts_models_dir
    qwen_port = qwen_port
    qwen_backend = qwen_backend

    stt_provider = stt_provider
    stt_model = stt_model
    stt_model_en = stt_model_en
    stt_language = stt_language
    stt_wake_word_enabled = stt_wake_word_enabled
    stt_wake_word_threshold = stt_wake_word_threshold
    stt_wake_word_cooldown = stt_wake_word_cooldown
    stt_vad_enabled = stt_vad_enabled
    stt_vad_mode = stt_vad_mode
    stt_vad_silence_timeout = stt_vad_silence_timeout
    stt_vad_auto_calibrate = stt_vad_auto_calibrate
    stt_vad_rms_threshold = stt_vad_rms_threshold
    input_mode = input_mode

    qwen_asr_model = qwen_asr_model
    qwen_asr_device = qwen_asr_device
    qwen_asr_streaming = qwen_asr_streaming
    qwen_asr_models_dir = qwen_asr_models_dir

    vision_mode = vision_mode

    active_profile = active_profile

    artifact_diff_preview = artifact_diff_preview

    searxng_url = searxng_url

    db_path = db_path
    images_dir = images_dir
    snapshots_dir = snapshots_dir
    data_dir = data_dir

    voices_dir = voices_dir
    voice_configs_dir = voice_configs_dir
    stt_models_dir = stt_models_dir
    tts_models_dir = tts_models_dir
    profiles_dir = profiles_dir

    game_session_path = game_session_path
    game_ai_global_timeout_ms = game_ai_global_timeout_ms

    game_connection_id = game_connection_id
    game_model = game_model
    game_temperature = game_temperature
    game_max_tokens = game_max_tokens
    game_retry_timeouts = game_retry_timeouts
    game_max_retries = game_max_retries


settings = _Settings()