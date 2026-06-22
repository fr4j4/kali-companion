"""kali-voice — TTS engine (the cat's voice).

    Converts text into playable audio, with `glados-es` (GLaDOS Piper model) as
    the default voice. Customizable via JSON voice configs.

Architecture is hybrid: in-process Piper by default (`InProcTTSProvider`),
or an external HTTP TTS service (`HTTPTTSProvider`) via config. Both
implement `TTSProvider`, so the rest of Kali is agnostic.

See docs/COMPONENTS.md#kali-voice for the full spec.
"""

from .pipeline import TTSPipeline
from .providers.base import TTSProvider, TTSResult
from .providers.http import HTTPTTSProvider
from .providers.inproc import InProcTTSProvider
from .voice_config import VoiceConfigManager

__all__ = [
    "TTSPipeline",
    "TTSProvider",
    "TTSResult",
    "InProcTTSProvider",
    "HTTPTTSProvider",
    "VoiceConfigManager",
]