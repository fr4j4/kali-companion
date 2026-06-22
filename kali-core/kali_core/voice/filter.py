"""Smart TTS text filter — prepares LLM responses for speech.

Strips content that should not be read aloud (code blocks, URLs, markdown
syntax) while preserving the meaning for the listener, and splits long
responses into natural speech segments for streaming synthesis.

Ported from the legacy ai-voice-companion prototype. Logic unchanged; only
imports adjusted for the new package layout.
"""

from __future__ import annotations

import re
import unicodedata

from kali_core.config import settings

# Emoji and decorative unicode ranges an LLM is likely to emit: emoticons,
# pictographs, dingbats, flags, variation selectors, ZWJ, and a few stray
# symbols. The So/Sk/Mn category fallback below catches anything else.
_EMOJI_RANGE_RE = re.compile(
    "["
    r"\U0001F000-\U0001FAFF"  # Chess, emoticons, supplemental symbols & pictographs
    r"\U0001F1E6-\U0001F1FF"  # Regional indicator letters (flag pairs)
    r"\U0001F300-\U0001F5FF"  # Misc symbols & pictographs
    r"\U0001F600-\U0001F64F"  # Emoticons
    r"\U0001F680-\U0001F6FF"  # Transport & map
    r"\U0001F900-\U0001F9FF"  # Supplemental symbols & pictographs
    r"\U00002600-\U000027BF"  # Misc symbols & dingbats
    r"\U0000FE00-\U0000FE0F"  # Variation selectors
    r"\U0000200D"             # Zero-width joiner
    r"\U00002122\U000000A9\U000000AE\U00002139"  # ™ © ® ℹ
    "]",
    flags=re.UNICODE,
)


def _strip_emojis(text: str) -> str:
    """Remove emoji and decorative unicode symbols, collapse leftover gaps."""
    if not text:
        return text
    # Fast path: drop obvious emoji ranges in one pass.
    cleaned = _EMOJI_RANGE_RE.sub(" ", text)
    # Fallback: remove any remaining chars whose category is "So" (Symbol,
    # other) or modifier symbols (Sk) that Piper cannot speak, but keep a
    # few that are actually spoken (°, ·).
    cleaned = "".join(
        ch
        for ch in cleaned
        if unicodedata.category(ch) not in ("So", "Sk", "Mn")
        or ch in ("°", "·")
    )
    return cleaned


def filter_for_tts(text: str) -> str:
    """Transform raw text into a speech-friendly form.

    - Code blocks: replaced with a brief placeholder.
    - Inline code: strip backticks, keep content.
    - URLs: strip raw URLs, keep link text.
    - Markdown formatting: strip syntax (`**`, `*`, `#`, etc.).
    - Emojis and decorative unicode: stripped (the TTS engine would read
      them as "unicode" or ignore them, polluting the audio).
    - File paths: abbreviate long paths.
    - Very long text: truncate at a natural break.
    """
    if not text or not text.strip():
        return ""

    result = text

    # Code blocks.
    result = re.sub(r"```[\w]*\n[\s\S]*?```", " [code omitted] ", result)
    result = re.sub(r"^(?: {4,}|\t+).+$", " [code omitted] ", result, flags=re.MULTILINE)

    # Inline code.
    result = re.sub(r"`([^`]+)`", r"\1", result)

    # URLs.
    result = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", result)
    result = re.sub(r"https?://[^\s,;)\]>]+", "", result)

    # File paths: abbreviate.
    result = re.sub(r"(?:/[\w.-]+){3,}(/[\w.-]+)", r"...\1", result)

    # Markdown formatting.
    result = re.sub(r"^#{1,6}\s+", "", result, flags=re.MULTILINE)
    result = re.sub(r"\*\*(.+?)\*\*", r"\1", result)
    result = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", result)
    result = re.sub(r"~~(.+?)~~", r"\1", result)
    result = re.sub(r"^\s*[-*]\s+", "", result, flags=re.MULTILINE)
    result = re.sub(r"^\s*\d+\.\s+", "", result, flags=re.MULTILINE)
    result = re.sub(r"^[-*_]{3,}\s*$", "", result, flags=re.MULTILINE)
    result = re.sub(r"^\|[\s\-:|]+\|\s*$", "", result, flags=re.MULTILINE)
    result = re.sub(r"\|", ", ", result)
    result = re.sub(r"<[^>]+>", "", result)

    # Emojis & decorative unicode — done after markdown/code handling so
    # backticks (category Sk) survive until the inline-code regex above.
    result = _strip_emojis(result)

    # Whitespace cleanup.
    result = re.sub(r"\n{3,}", "\n\n", result)
    result = re.sub(r"[ \t]+", " ", result)
    result = result.strip()

    # Truncate long text.
    max_len = settings.tts_max_length
    if len(result) > max_len:
        cutoff = result.rfind(". ", max_len // 2, max_len)
        if cutoff == -1:
            cutoff = result.rfind(", ", max_len // 2, max_len)
        if cutoff == -1:
            cutoff = result.rfind(" ", max_len // 2, max_len)
        if cutoff > 0:
            result = result[: cutoff + 1].rstrip() + "..."
        else:
            result = result[:max_len].rstrip() + "..."

    return result


def segment_for_tts(text: str, max_chunk: int = 500) -> list[str]:
    """Split filtered text into natural speech segments ≤ max_chunk chars."""
    if not text or not text.strip():
        return []

    paragraphs = re.split(r"\n\n+", text)
    chunks: list[str] = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 2 <= max_chunk:
            current_chunk = (current_chunk + "\n\n" + para).strip() if current_chunk else para
        else:
            if current_chunk:
                chunks.append(current_chunk)
            if len(para) > max_chunk:
                sentences = re.split(r"(?<=[.!?])\s+", para)
                current_chunk = ""
                for sent in sentences:
                    if len(current_chunk) + len(sent) + 1 <= max_chunk:
                        current_chunk = (current_chunk + " " + sent).strip()
                    else:
                        if current_chunk:
                            chunks.append(current_chunk)
                        current_chunk = sent
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    return chunks