"""Qwen3-TTS provider — manages the C++ tts-server binary as a subprocess.

This provider implements the TTSProvider Protocol by spawning the qwen-tts-cpp-server
tts-server binary and communicating with it over HTTP (OpenAI-compatible endpoint).

Supports two modes:
  - qwen3 (0.6B CustomVoice): 9 predefined named speakers
  - qwen3-voicedesign (1.7B VoiceDesign): text instruction + seed for voice generation
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

from kali_core.voice.providers.base import StartupError, TTSProvider, TTSResult

logger = logging.getLogger("kali_core.voice.qwen")

# ── Fixed binary locations ──────────────────────────────────────────────
# Binaries are NOT configurable via env vars. The C++ build scripts emit
# them under voice/qwen_cpp/{build => CPU, build-gpu => CUDA}. If the
# requested backend's binary is missing, Qwen falls back to CPU; if the
# CPU binary is also missing, loading is cancelled with a clear error.
_QWEN_CPP_DIR = Path(__file__).resolve().parent.parent / "qwen_cpp"
_QWEN_BINARY_CPU = _QWEN_CPP_DIR / "build" / "tts-server"
_QWEN_BINARY_GPU = _QWEN_CPP_DIR / "build-gpu" / "tts-server"


def _normalize_backend(device: str) -> str:
    """Map a UI/endpoint device string to the GGML backend name.

    Accepts (case-insensitive):
      - "cpu"           -> "CPU"
      - "cuda:0","cuda0","CUDA0","cuda:1" -> "CUDA0","CUDA1", ...
    Anything else raises ValueError; only CPU and CUDA are supported.
    """
    if not device:
        return "CPU"
    s = device.strip()
    low = s.lower()
    if low == "cpu":
        return "CPU"
    m = re.match(r"^cuda[:_\-]?(\d+)$", low)
    if m:
        return f"CUDA{m.group(1)}"
    raise ValueError(
        f"Unsupported Qwen3-TTS device '{device}'. Supported: 'cpu', 'cuda0', 'cuda1', ..."
    )


def _backend_to_ui(backend: str) -> str:
    """Inverse of _normalize_backend: 'CPU' -> 'cpu', 'CUDA0' -> 'cuda0'."""
    if not backend:
        return "cpu"
    low = backend.lower()
    if low == "cpu":
        return "cpu"
    m = re.match(r"^cuda(\d+)$", low)
    if m:
        return f"cuda{m.group(1)}"
    return low


def _resolve_binary(backend: str) -> Path:
    """Return the fixed tts-server path for a normalized backend name."""
    return _QWEN_BINARY_GPU if backend.startswith("CUDA") else _QWEN_BINARY_CPU


def _nvidia_smi_available() -> bool:
    try:
        subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, timeout=5,
        )
        return True
    except (OSError, subprocess.SubprocessError):
        return False


QWEN_MODELS: dict[str, dict] = {
    "qwen3-tts-0.6b-customvoice": {
        "filename": "qwen-talker-0.6b-customvoice-Q4_K_M.gguf",
        "variant": "customvoice",
        "display_name": "Qwen3-TTS 0.6B CustomVoice",
        "estimated_vram_mb": 600,
    },
    "qwen3-tts-1.7b-voicedesign": {
        "filename": "qwen-talker-1.7b-voicedesign-Q4_K_M.gguf",
        "variant": "voicedesign",
        "display_name": "Qwen3-TTS 1.7B VoiceDesign",
        "estimated_vram_mb": 1700,
    },
}

PREDEFINED_VOICES = [
    {"id": "serena",   "name": "Serena",   "gender": "female"},
    {"id": "vivian",   "name": "Vivian",   "gender": "female"},
    {"id": "ono_anna", "name": "Ono Anna", "gender": "female"},
    {"id": "sohee",    "name": "Sohee",    "gender": "female"},
    {"id": "aiden",    "name": "Aiden",    "gender": "male"},
    {"id": "dylan",    "name": "Dylan",    "gender": "male"},
    {"id": "eric",     "name": "Eric",     "gender": "male"},
    {"id": "ryan",     "name": "Ryan",     "gender": "male"},
    {"id": "uncle_fu", "name": "Uncle Fu", "gender": "male"},
]

VOICE_DESIGN_PRESETS = [
    {"id": "warm-female",      "name": "Warm Female",
     "instructions": "A young female voice, warm and gentle, moderate pacing.",          "seed": 42},
    {"id": "deep-male",        "name": "Deep Male",
     "instructions": "A deep male voice, calm and authoritative, slow pacing.",         "seed": 100},
    {"id": "sad-female",       "name": "Sad Female",
     "instructions": "A crying, deeply sad, and trembling female voice, slow pacing.",  "seed": 200},
    {"id": "energetic-male",   "name": "Energetic Male",
     "instructions": "An excited and energetic young male voice, fast pacing.",         "seed": 300},
    {"id": "whisper-female",   "name": "Whisper Female",
     "instructions": "A soft whispering female voice, mysterious and quiet.",            "seed": 400},
    {"id": "elderly-male",     "name": "Elderly Male",
     "instructions": "An elderly male voice, wise and slow, with a slight rasp.",         "seed": 500},
    {"id": "cheerful-female",  "name": "Cheerful Female",
     "instructions": "A cheerful female voice, bright and bubbly, fast pacing.",         "seed": 600},
    {"id": "professional-male","name": "Professional Male",
     "instructions": "A serious male voice, neutral and professional, moderate pacing.","seed": 700},
]

PREVIEW_TEXTS: dict[str, list[str]] = {
    "en": [
        "Hello, I am Kali, your virtual assistant. I am here to help you with whatever you need.",
        "Hi there! I am Kali, and I am happy to be your assistant today.",
        "Welcome! I am Kali, ready to assist you with any task.",
        "Hello! This is Kali, your personal AI companion at your service.",
        "Hey, I am Kali! I am here to make your day easier and more productive.",
        "Good day! I am Kali, your trusted assistant ready to help.",
        "Hello! I am Kali, and I will be assisting you today. How can I help?",
        "Hi! I am Kali, your virtual assistant. What can I do for you?",
        "Welcome! This is Kali, and I am at your service.",
        "Hello! I am Kali, your AI assistant. I am looking forward to helping you.",
    ],
    "es": [
        "Hola, soy Kali, tu asistente virtual. Estoy aquí para ayudarte en lo que necesites.",
        "¡Hola! Soy Kali, tu asistente virtual. ¡Estoy feliz de estar aquí contigo!",
        "Bienvenido, soy Kali. Estoy listo para ayudarte con cualquier tarea.",
        "¡Hola! Soy Kali, tu compañero de inteligencia artificial a tu servicio.",
        "Hey, soy Kali. Estoy aquí para hacer tu día más fácil y productivo.",
        "¡Buen día! Soy Kali, tu asistente de confianza, listo para ayudarte.",
        "¡Hola! Soy Kali y hoy seré tu asistente. ¿En qué puedo ayudarte?",
        "¡Hola! Soy Kali, tu asistente virtual. ¿Qué puedo hacer por ti hoy?",
        "¡Bienvenido! Soy Kali y estoy a tu servicio.",
        "¡Hola! Soy Kali, tu asistente de inteligencia artificial. ¡Estoy ansioso por ayudarte!",
    ],
    "fr": [
        "Bonjour, je suis Kali, votre assistant virtuel. Je suis là pour vous aider.",
        "Salut! Je suis Kali, et je suis heureux d'être votre assistant aujourd'hui.",
        "Bienvenue! Je suis Kali, prêt à vous aider.",
        "Bonjour! Je suis Kali, votre compagnon IA à votre service.",
        "Hé, je suis Kali! Je suis là pour faciliter votre journée.",
        "Bonjour! Je suis Kali, votre assistant de confiance.",
        "Bonjour! Je suis Kali, et je serai votre assistant aujourd'hui.",
        "Salut! Je suis Kali, votre assistant virtuel. Que puis-je faire pour vous?",
        "Bienvenue! Je suis Kali, à votre service.",
        "Bonjour! Je suis Kali, votre assistant IA. J'ai hâte de vous aider!",
    ],
    "de": [
        "Hallo, ich bin Kali, Ihr virtueller Assistent. Ich bin hier, um Ihnen zu helfen.",
        "Hallo! Ich bin Kali, und ich freue mich, heute Ihr Assistent zu sein.",
        "Willkommen! Ich bin Kali, bereit, Ihnen bei jeder Aufgabe zu helfen.",
        "Hallo! Ich bin Kali, Ihr persönlicher KI-Begleiter zu Ihren Diensten.",
        "Hey, ich bin Kali! Ich bin hier, um Ihren Tag zu erleichtern.",
        "Guten Tag! Ich bin Kali, Ihr vertrauenswürdiger Assistent.",
        "Hallo! Ich bin Kali, und ich werde Ihnen heute helfen.",
        "Hallo! Ich bin Kali, Ihr virtueller Assistent. Was kann ich für Sie tun?",
        "Willkommen! Ich bin Kali, zu Ihren Diensten.",
        "Hallo! Ich bin Kali, Ihr KI-Assistent. Ich freue mich darauf, Ihnen zu helfen.",
    ],
    "it": [
        "Ciao, sono Kali, il tuo assistente virtuale. Sono qui per aiutarti.",
        "Ciao! Sono Kali, e sono felice di essere il tuo assistente oggi.",
        "Benvenuto! Sono Kali, pronto ad aiutarti con qualsiasi compito.",
        "Ciao! Sono Kali, il tuo compagno IA al tuo servizio.",
        "Ehi, sono Kali! Sono qui per rendere la tua giornata più facile.",
        "Buongiorno! Sono Kali, il tuo assistente di fiducia.",
        "Ciao! Sono Kali, e sarò il tuo assistente oggi.",
        "Ciao! Sono Kali, il tuo assistente virtuale. Cosa posso fare per te?",
        "Benvenuto! Sono Kali, al tuo servizio.",
        "Ciao! Sono Kali, il tuo assistente IA. Non vedo l'ora di aiutarti!",
    ],
    "pt": [
        "Olá, eu sou Kali, sua assistente virtual. Estou aqui para ajudar você.",
        "Olá! Eu sou Kali, e estou feliz em ser seu assistente hoje.",
        "Bem-vindo! Eu sou Kali, pronto para ajudar com qualquer tarefa.",
        "Olá! Eu sou Kali, seu companheiro de IA ao seu serviço.",
        "Ei, eu sou Kali! Estou aqui para facilitar seu dia.",
        "Bom dia! Eu sou Kali, sua assistente de confiança.",
        "Olá! Eu sou Kali, e vou ajudá-lo hoje.",
        "Olá! Eu sou Kali, sua assistente virtual. O que posso fazer por você?",
        "Bem-vindo! Eu sou Kali, ao seu serviço.",
        "Olá! Eu sou Kali, sua assistente de IA. Estou ansioso para ajudá-lo!",
    ],
    "zh": [
        "你好，我是Kali，你的虚拟助手。我在这里帮助你。",
        "你好！我是Kali，很高兴今天成为你的助手。",
        "欢迎！我是Kali，准备好帮助你完成任务。",
        "你好！我是Kali，你的个人AI助手为你服务。",
        "嘿，我是Kali！我在这里让你的生活更轻松。",
        "你好！我是Kali，你值得信赖的助手。",
        "你好！我是Kali，今天我将为你提供帮助。",
        "你好！我是Kali，你的虚拟助手。有什么可以帮你的？",
        "欢迎！我是Kali，为你服务。",
        "你好！我是Kali，你的AI助手。期待帮助你！",
    ],
    "ja": [
        "こんにちは、私はKaliです。バーチャルアシスタントです。您的位置を支援します。",
        "こんにちは！私はKaliです。今日はあなたのアシスタントになれて嬉しいです。",
        "ようこそ！私はKaliです。どんなタスクでもお手伝いする準備ができています。",
        "こんにちは！私はKali、あなたのパーソナルAIコンパニオンです。",
        "ねえ、私はKaliです！あなたの日を更容易にするためにここにあります。",
        "こんにちは！私はKali、信頼できるアシスタントです。",
        "こんにちは！私はKali、今日はあなたをお手伝いします。",
        "こんにちは！私はKali、バーチャルアシスタントです。何をすればいいですか？",
        "ようこそ！私はKali为您服务。",
        "こんにちは！私はKali、AIアシスタントです。お手伝いできるのを楽しみにしています！",
    ],
    "ko": [
        "안녕하세요, 저는 Kali입니다. 가상 비서입니다. 도움을 드리겠습니다.",
        "안녕하세요! 저는 Kali입니다. 오늘 당신의 비서가 되어 기쁩니다.",
        "환영합니다! 저는 Kali입니다. 어떤 작업이든 도와드릴 준비가 되었습니다.",
        "안녕하세요! 저는 Kali입니다. 당신을 위한 개인 AI 동반자입니다.",
        "헤이, 저는 Kali입니다! 당신의 하루를 더 쉽게 만들어 드리겠습니다.",
        "안녕하세요! 저는 Kali입니다. 신뢰할 수 있는 비서입니다.",
        "안녕하세요! 저는 Kali입니다. 오늘 당신을 도울 것입니다.",
        "안녕하세요! 저는 Kali입니다. 가상 비서입니다. 무엇을 도와드릴까요?",
        "환영합니다! 저는 Kali입니다. 당신을 위해 여기 있습니다.",
        "안녕하세요! 저는 Kali입니다. AI 비서입니다. 도움을 드리게 되어 기쁩니다!",
    ],
}

def _normalize_language(language: str) -> str:
    """Normalize a language code to a base supported by the C++ tts-server.

    The C++ tts-server and PREVIEW_TEXTS use base codes (en, es, fr, de, ko).
    Regional variants like 'es-CL' or 'es-MX' are mapped to their base.
    """
    if not language:
        return "en"
    base = language.split("-")[0].split("_")[0].lower()
    if base not in PREVIEW_TEXTS:
        return "en"
    return base


def get_random_preview_text(language: str = "en") -> str:
    """Return a random preview text for the given language code."""
    normalized = _normalize_language(language)
    texts = PREVIEW_TEXTS.get(normalized, PREVIEW_TEXTS["en"])
    return random.choice(texts)


class QwenTTSProvider:
    """Manages the qwen-tts-cpp-server C++ binary as a native subprocess.

    A single provider id 'qwen3' with two loadable models:
      - qwen3-tts-0.6b-customvoice (stock voices: Serena, Aiden, etc.)
      - qwen3-tts-1.7b-voicedesign (voice design via instructions + seed)
    Switching models kills and respawns the subprocess with the other .gguf.
    """

    _provider_name = "qwen3"

    def __init__(
        self,
        *,
        talker_models_dir: str | Path,
        codec_model: str | Path,
        port: int = 8870,
        backend: str = "CPU",
        voice_design: bool = False,
        spawn: bool = False,
    ) -> None:
        self._talker_models_dir = Path(talker_models_dir).expanduser().resolve()
        self._codec_model = Path(codec_model).expanduser().resolve()
        self._port = port
        # Normalize the startup backend and resolve the matching fixed binary.
        # If the requested backend's binary is unavailable, fall back to CPU
        # (with a warning) so the server can still come up.
        self._backend = _normalize_backend(backend)
        self._binary = self._resolve_startup_binary()
        self._voice_design = voice_design
        self._instructions = ""
        self._seed = -1
        self._proc: subprocess.Popen[bytes] | None = None
        self._client: httpx.AsyncClient | None = None
        self._log_file: Path | None = None
        self._loaded_model_id: str | None = None
        self._last_error: str | None = None
        self._talker_model: Path | None = None
        self._available_models: dict[str, Path] = {}
        self._discover_talker_models()
        self._select_initial_model(voice_design)
        if spawn:
            self._validate_and_spawn()

    def _resolve_startup_binary(self) -> Path:
        """Pick the binary for self._backend, falling back to CPU when missing.

        Only used at construction time. load_model() re-resolves on every
        device change so a runtime GPU->CPU or CPU->GPU switch swaps the
        binary in the same subprocess lifecycle.
        """
        wanted = _resolve_binary(self._backend)
        if wanted.exists():
            return wanted
        if self._backend != "CPU":
            logger.warning(
                "Qwen3-TTS: %s backend requested but binary not found at %s; "
                "falling back to CPU binary. Run: scripts/build-qwen-cpp.sh cuda",
                self._backend, wanted,
            )
            self._backend = "CPU"
        cpu = _resolve_binary("CPU")
        if cpu.exists():
            return cpu
        logger.error(
            "Qwen3-TTS: no CPU binary found at %s. Run: scripts/build-qwen-cpp.sh cpu",
            cpu,
        )
        return cpu  # let _validate_and_spawn report the missing file

    # ── public TTSProvider interface ─────────────────────────────────

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def is_loaded(self) -> bool:
        return (
            self._client is not None
            and self._proc is not None
            and self._proc.poll() is None
        )

    @property
    def device(self) -> str | None:
        return _backend_to_ui(self._backend) if self.is_loaded else None

    @property
    def loaded_model(self) -> str | None:
        return self._loaded_model_id

    @property
    def is_available(self) -> bool:
        return self._client is not None

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def tts_variant(self) -> str:
        return "voicedesign" if self._voice_design else "customvoice"

    async def synthesize(
        self,
        text: str,
        voice: str,
        mode: str = "normal",
        language: str = "auto",
    ) -> TTSResult:
        if self._client is None:
            raise RuntimeError("QwenTTSProvider not started (client is None)")

        normalized_lang = (
            _normalize_language(language)
            if language and language != "auto"
            else "auto"
        )
        valid_voices = {v["id"] for v in PREDEFINED_VOICES}
        if self._voice_design:
            effective_voice = "serena"
        elif voice in valid_voices:
            effective_voice = voice
        else:
            effective_voice = "serena"

        payload: dict[str, Any] = {
            "input": text,
            "voice": effective_voice,
            "language": normalized_lang,
            "response_format": "wav",
            "speed": 1.0,
        }
        if self._voice_design:
            if not self._instructions.strip() and self._seed == -1:
                preset = VOICE_DESIGN_PRESETS[0]
                payload["instructions"] = preset["instructions"]
                payload["seed"] = preset["seed"]
            else:
                payload["instructions"] = self._instructions
                payload["seed"] = self._seed

        logger.info(
            "synthesize request: voice=%s variant=%s lang=%s chars=%d text_preview=%r",
            effective_voice,
            "voicedesign" if self._voice_design else "customvoice",
            normalized_lang,
            len(text),
            text[:80],
        )
        t0 = time.perf_counter()
        resp = await self._client.post("/v1/audio/speech", json=payload, timeout=60.0)
        elapsed = time.perf_counter() - t0
        logger.info(
            "synthesize response: status=%d %.3fs bytes=%d",
            resp.status_code,
            elapsed,
            len(resp.content),
        )
        resp.raise_for_status()

        return TTSResult(
            audio=resp.content,
            sample_rate=24000,
            duration=0.0,
            mode=mode,
            segment=0,
        )

    async def list_voices(self, variant: str | None = None) -> list[dict]:
        effective = variant or ("voicedesign" if self._voice_design else "customvoice")
        if effective == "voicedesign":
            return [
                {"id": p["id"], "name": p["name"],
                 "instructions": p["instructions"], "seed": p["seed"]}
                for p in VOICE_DESIGN_PRESETS
            ]
        return [
            {"id": v["id"], "name": v["name"], "gender": v["gender"]}
            for v in PREDEFINED_VOICES
        ]

    async def preview(
        self,
        voice_id: str,
        instructions: str = "",
        seed: int = -1,
        text: str = "",
        language: str = "auto",
        mode: str = "normal",
    ) -> bytes:
        if self._client is None:
            raise RuntimeError("QwenTTSProvider not started (client is None)")

        if not text:
            text = get_random_preview_text(language)

        normalized_lang = (
            _normalize_language(language)
            if language and language != "auto"
            else "auto"
        )
        valid_voices = {v["id"] for v in PREDEFINED_VOICES}
        if self._voice_design:
            effective_voice = "serena"
        elif voice_id in valid_voices:
            effective_voice = voice_id
        else:
            effective_voice = "serena"

        payload: dict[str, Any] = {
            "input": text,
            "voice": effective_voice,
            "language": normalized_lang,
            "response_format": "wav",
            "speed": 1.0,
        }
        if self._voice_design:
            if not (instructions and instructions.strip()):
                preset = VOICE_DESIGN_PRESETS[0]
                payload["instructions"] = preset["instructions"]
                payload["seed"] = preset["seed"] if seed == -1 else seed
            else:
                payload["instructions"] = instructions
                payload["seed"] = seed

        logger.info(
            "preview request: voice=%s variant=%s lang=%s chars=%d",
            effective_voice,
            "voicedesign" if self._voice_design else "customvoice",
            normalized_lang,
            len(text),
        )
        t0 = time.perf_counter()
        resp = await self._client.post("/v1/audio/speech", json=payload, timeout=60.0)
        elapsed = time.perf_counter() - t0
        logger.info(
            "preview response: status=%d %.3fs bytes=%d",
            resp.status_code,
            elapsed,
            len(resp.content),
        )
        resp.raise_for_status()
        return resp.content

    def set_voice_design(self, instructions: str, seed: int) -> None:
        """Update the current instruction text and seed for voicedesign mode."""
        self._instructions = instructions
        self._seed = seed

    # ── model management ───────────────────────────────────────────

    def configure(self, *, models_dir: str | Path | None = None) -> None:
        """Re-point the provider to a different models directory.

        Used when the user changes `tts_models_dir` from the UI.  Rescans
        available models and, if a model is currently loaded, reloads the
        same one from the new directory so the new path takes effect
        immediately.
        """
        if models_dir is None:
            return
        was_loaded = self.is_loaded
        current_id = self._loaded_model_id
        current_device = self.device
        if was_loaded:
            self.shutdown()
        self._talker_models_dir = Path(models_dir).expanduser().resolve()
        self._codec_model = self._talker_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf"
        self._discover_talker_models()
        if current_id is not None and current_id in self._available_models:
            self._talker_model = self._available_models[current_id]
            self._loaded_model_id = current_id
            self._voice_design = QWEN_MODELS[current_id]["variant"] == "voicedesign"
            if was_loaded:
                self._validate_and_spawn()
        else:
            self._select_initial_model(self._voice_design)

    def _discover_talker_models(self) -> dict[str, Path]:
        result: dict[str, Path] = {}
        for mid, cfg in QWEN_MODELS.items():
            path = self._talker_models_dir / cfg["filename"]
            if path.exists():
                result[mid] = path
        self._available_models = result
        return result

    def _select_initial_model(self, voice_design: bool) -> None:
        preferred = (
            "qwen3-tts-1.7b-voicedesign" if voice_design
            else "qwen3-tts-0.6b-customvoice"
        )
        if preferred in self._available_models:
            self._talker_model = self._available_models[preferred]
            self._voice_design = voice_design
            self._loaded_model_id = preferred
            return
        if self._available_models:
            any_id = next(iter(self._available_models))
            self._talker_model = self._available_models[any_id]
            self._voice_design = QWEN_MODELS[any_id]["variant"] == "voicedesign"
            self._loaded_model_id = any_id
            return
        self._talker_model = None

    def list_models(self) -> list:
        from .base import TTSModelInfo, TTSModelVoice
        models: list[TTSModelInfo] = []
        for mid, cfg in QWEN_MODELS.items():
            path = self._talker_models_dir / cfg["filename"]
            is_loaded = (mid == self._loaded_model_id and self.is_loaded)
            voices: list[TTSModelVoice] = []
            if cfg["variant"] == "customvoice":
                for v in PREDEFINED_VOICES:
                    voices.append(TTSModelVoice(
                        id=v["id"], name=v["name"], gender=v["gender"], source="speaker",
                    ))
            else:
                for p in VOICE_DESIGN_PRESETS:
                    voices.append(TTSModelVoice(
                        id=p["id"], name=p["name"], source="preset",
                    ))
            models.append(TTSModelInfo(
                id=mid,
                display_name=cfg["display_name"],
                estimated_vram_mb=cfg["estimated_vram_mb"],
                available=path.exists(),
                loaded=is_loaded,
                device=_backend_to_ui(self._backend) if is_loaded else None,
                supported_languages=["en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko"],
                voices=voices,
                variant=cfg["variant"],
            ))
        return models

    def load_model(self, model_id: str, device: str = "cpu") -> None:
        if model_id not in QWEN_MODELS:
            raise ValueError(f"Unknown Qwen3-TTS model: {model_id}")
        new_backend = _normalize_backend(device)
        # No-op only when the same model AND same backend are already loaded.
        if (
            model_id == self._loaded_model_id
            and new_backend == self._backend
            and self.is_loaded
        ):
            return
        new_path = self._talker_models_dir / QWEN_MODELS[model_id]["filename"]
        if not new_path.exists():
            raise FileNotFoundError(
                f"Talker model not found: {new_path}\n"
                f"  Run: scripts/download-qwen-models.sh {QWEN_MODELS[model_id]['variant']}"
            )

        # Resolve the binary for the requested backend. If a GPU backend is
        # requested but its binary (or nvidia-smi) is unavailable, fall back
        # to CPU with a warning so the model still loads. If the CPU binary
        # is missing too, _validate_and_spawn below raises StartupError.
        effective_backend = new_backend
        effective_binary = _resolve_binary(new_backend)
        if new_backend.startswith("CUDA"):
            if not effective_binary.exists() or not _nvidia_smi_available():
                logger.warning(
                    "Qwen3-TTS: GPU backend '%s' requested but %s; "
                    "falling back to CPU. Run: scripts/build-qwen-cpp.sh cuda",
                    new_backend,
                    "binary not found" if not effective_binary.exists()
                    else "nvidia-smi not available",
                )
                effective_backend = "CPU"
                effective_binary = _resolve_binary("CPU")

        old_talker_model = self._talker_model
        old_voice_design = self._voice_design
        old_backend = self._backend
        old_binary = self._binary
        old_loaded_model_id = self._loaded_model_id
        self.shutdown()
        self._talker_model = new_path
        self._voice_design = QWEN_MODELS[model_id]["variant"] == "voicedesign"
        self._backend = effective_backend
        self._binary = effective_binary
        self._last_error = None
        try:
            self._validate_and_spawn()
            self._loaded_model_id = model_id
        except StartupError as exc:
            self._talker_model = old_talker_model
            self._voice_design = old_voice_design
            self._backend = old_backend
            self._binary = old_binary
            self._loaded_model_id = old_loaded_model_id
            self._last_error = str(exc)
            raise

    def unload_model(self) -> None:
        self.shutdown()
        self._loaded_model_id = None
        self._client = None
        self._proc = None

    # ── lifecycle ───────────────────────────────────────────────────

    def _validate_and_spawn(self) -> None:
        errors: list[str] = []

        if not self._binary.exists():
            build_target = "cuda" if self._backend.startswith("CUDA") else "cpu"
            errors.append(
                f"Qwen3-TTS binary not found at: {self._binary}\n"
                f"  Run: scripts/build-qwen-cpp.sh {build_target}"
            )
        elif not os.access(self._binary, os.X_OK):
            errors.append(f"Qwen3-TTS binary is not executable: {self._binary}")

        # Defensive: the runtime fallback in load_model() should already have
        # demoted a CUDA request to CPU when nvidia-smi is missing, but if we
        # get here with a CUDA backend (e.g. startup with KALI_QWEN_BACKEND
        # set to CUDA0) surface a clear error instead of letting the C++
        # binary fail opaquely.
        if self._backend.startswith("CUDA") and not _nvidia_smi_available():
            errors.append(
                "Qwen3-TTS CUDA backend requested but nvidia-smi is not available. "
                "Install the NVIDIA driver or use CPU."
            )

        if self._talker_model is None or not self._talker_model.exists():
            model_id = "1.7b-voicedesign" if self._voice_design else "0.6b-customvoice"
            path_str = str(self._talker_model) if self._talker_model else "(none selected)"
            errors.append(
                f"Talker model not found at: {path_str}\n"
                f"  Run: scripts/download-qwen-models.sh {model_id}"
            )

        if not self._codec_model.exists():
            errors.append(
                f"Codec model not found at: {self._codec_model}\n"
                f"  Run: scripts/download-qwen-models.sh   (tokenizer is included)"
            )

        if errors:
            raise StartupError(
                "Qwen3-TTS cannot start. Missing requirements:\n\n"
                + "\n\n".join(errors)
            )

        self._spawn_server()

    def _spawn_server(self) -> None:
        log_path = Path("/tmp") / f"qwen-tts-{self._port}.log"
        self._log_file = log_path

        env = os.environ.copy()
        if self._backend.startswith("CUDA"):
            for cuda_path in ("/opt/cuda/lib64", "/usr/local/cuda/lib64", "/usr/lib/cuda/lib64"):
                if os.path.isdir(cuda_path):
                    env["LD_LIBRARY_PATH"] = f"{cuda_path}:{env.get('LD_LIBRARY_PATH', '')}"
                    break
        # Always export GGML_BACKEND so the C++ binary picks the right device
        # (CPU or CUDA0/CUDA1). Without this, the C++ auto-selects the best
        # backend which may not match the user's choice.
        env["GGML_BACKEND"] = self._backend

        logger.info(
            "Spawning qwen-tts-server: binary=%s talker=%s codec=%s port=%s backend=%s",
            self._binary, self._talker_model, self._codec_model, self._port, self._backend,
        )

        self._proc = subprocess.Popen(
            [
                str(self._binary),
                "--model", str(self._talker_model),
                "--codec", str(self._codec_model),
                "--host", "127.0.0.1",
                "--port", str(self._port),
            ],
            stdout=open(log_path, "w"),
            stderr=subprocess.STDOUT,
            env=env,
        )

        self._wait_for_health()

        base_url = f"http://127.0.0.1:{self._port}"
        self._client = httpx.AsyncClient(base_url=base_url, timeout=30.0)
        logger.info("QwenTTSProvider ready at %s", base_url)

    def _wait_for_health(self) -> None:
        timeout = 60.0 if self._backend.startswith("CUDA") else 30.0
        step = 1.0
        elapsed = 0.0
        log_detail = ""

        while elapsed < timeout:
            if self._proc is None or self._proc.poll() is not None:
                if self._log_file:
                    try:
                        log_detail = self._log_file.read_text()[-2000:]
                    except Exception:
                        log_detail = "(could not read log)"
                raise StartupError(
                    f"qwen-tts-server exited during startup (code={self._proc.poll() if self._proc else 'N/A'}).\n"
                    f"Last lines of log ({self._log_file}):\n{log_detail}"
                )
            try:
                import urllib.request
                req = urllib.request.Request(f"http://127.0.0.1:{self._port}/health")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    if resp.status == 200:
                        if self._proc is None or self._proc.poll() is not None:
                            raise StartupError(
                                "qwen-tts-server health check passed but our subprocess "
                                "is not running. A stale process may be occupying the port.\n"
                                f"Log ({self._log_file}):\n{log_detail}"
                            )
                        logger.info("qwen-tts-server health check passed (%.1fs)", elapsed)
                        return
            except StartupError:
                raise
            except Exception:
                pass
            time.sleep(step)
            elapsed += step

        if self._log_file:
            try:
                log_detail = self._log_file.read_text()[-2000:]
            except Exception:
                log_detail = "(could not read log)"

        if self._proc and self._proc.poll() is not None:
            raise StartupError(
                f"qwen-tts-server exited during startup (code={self._proc.poll()}).\n"
                f"Log ({self._log_file}):\n{log_detail}"
            )

        raise StartupError(
            f"qwen-tts-server did not respond after {timeout}s.\n"
            f"Log ({self._log_file}):\n{log_detail}"
        )

    def shutdown(self) -> None:
        logger.info("Shutting down qwen-tts-server (port %s)", self._port)
        if self._client:
            try:
                self._client.aclose()
            except Exception:
                pass
            self._client = None

        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait()
            self._proc = None

        self._kill_port_owner()

    def _kill_port_owner(self) -> None:
        """Kill any stray tts-server process listening on our port.

        If a previous server instance died without cleaning up its subprocess
        (e.g. crashed, was kill -9'd), the port may still be occupied.
        Without this, _wait_for_health would connect to the stale process
        and report a false-positive health check.
        """
        try:
            result = subprocess.run(
                ["fuser", f"{self._port}/tcp"],
                capture_output=True, text=True, timeout=3,
            )
            pids = [int(p) for p in result.stdout.split() if p.strip().isdigit()]
        except Exception:
            return
        own_pid = os.getpid()
        for pid in pids:
            if pid == own_pid:
                continue
            try:
                os.kill(pid, 15)
                logger.info("Killed stale process %d on port %d", pid, self._port)
            except ProcessLookupError:
                pass
            except PermissionError:
                pass
        if pids:
            time.sleep(0.5)
