"""kali-ear — STT engine (the cat's ears).

Real-time offline speech-to-text with multi-language support. Uses Vosk
in streaming mode: the browser sends 16 kHz 16-bit mono PCM chunks and
kali-ear returns partial/final transcripts.

Also provides wake word detection ("Hey Kali" / "Oye Kali") via Vosk
grammar mode — a lightweight always-on listener that triggers the main
STT session when the wake phrase is heard.
"""

from .manager import STTManager, WakeWordDetector
from .vosk_engine import StreamingSTT

__all__ = ["StreamingSTT", "STTManager", "WakeWordDetector"]