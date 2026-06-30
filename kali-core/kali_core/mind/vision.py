"""VisionProcessor — extracts text descriptions from images.

Supports two strategies:
  - `llm`: send the image to a vision-capable LLM (OpenAI-compatible,
    via content blocks with image_url).
  - `ocr`: use Tesseract OCR (pytesseract) to extract text.
  - `auto`: try LLM first, fall back to OCR.

Configured via KALI_VISION_MODE env var (default: auto).
"""

from __future__ import annotations

import base64
import logging
import os

logger = logging.getLogger("kali_core.mind.vision")

_MODE = os.getenv("KALI_VISION_MODE", "auto")


class VisionProcessor:
    """Processes image bytes and returns a text description."""

    # Models that have already failed a vision request this session.
    # Filled lazily by _via_llm when the API rejects an image — avoids
    # retrying the (expensive, 400-returning) call on every screenshot.
    _failed_models: set[str] = set()

    def __init__(self, llm_provider=None):
        self._llm = llm_provider

    @property
    def _model_name(self) -> str:
        return getattr(self._llm, "_model", "unknown")

    async def process(self, image_bytes: bytes, mime: str = "image/png") -> str:
        mode = _MODE
        if mode == "llm":
            return await self._via_llm(image_bytes, mime)
        elif mode == "ocr":
            return self._via_ocr(image_bytes)
        else:
            result = await self._via_llm(image_bytes, mime)
            if result.startswith("[vision"):
                fallback = self._via_ocr(image_bytes)
                result = f"{result} Fallback OCR: {fallback}"
            return result

    async def _via_llm(self, image_bytes: bytes, mime: str) -> str:
        if self._llm is None:
            return (
                "[vision via LLM unavailable: no LLM provider configured]"
            )
        # Skip the API call entirely if this model already failed a
        # vision request — saves ~1s of latency and avoids a 400.
        if self._model_name in self._failed_models:
            return (
                "[vision via LLM skipped: model does not support images]"
            )
        try:
            # Downscale + compress to JPEG so the base64 doesn't blow
            # the model's context window (common with 2 MB+ screenshots).
            processed_bytes, processed_mime = self._compress_image(
                image_bytes, mime
            )
            b64 = base64.b64encode(processed_bytes).decode()
            data_url = f"data:{processed_mime};base64,{b64}"
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Describe what is on this screen concisely. "
                                "List any visible text, UI elements, code, "
                                "or images you see."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ]
            result = await self._llm.complete(messages)
            text = result.get("text", "")
            if text and not text.startswith("[LLM error") and "Error del modelo de IA" not in text and "No pude conectar" not in text:
                return text
            # Model rejected the image — cache so we skip next time.
            self._failed_models.add(self._model_name)
            logger.warning(
                "LLM %s does not support images; caching for session",
                self._model_name,
            )
            return (
                "[vision via LLM failed: model may not support images]"
            )
        except Exception as e:
            self._failed_models.add(self._model_name)
            logger.warning("LLM vision failed: %s", e)
            return f"[vision via LLM failed: {e}]"

    @staticmethod
    def _compress_image(image_bytes: bytes, mime: str) -> tuple[bytes, str]:
        """Downscale to max 1024px and compress as JPEG to reduce token usage."""
        try:
            import io
            from PIL import Image

            img = Image.open(io.BytesIO(image_bytes))
            # Downscale if larger than 1024px on the longest edge.
            max_dim = 1024
            w, h = img.size
            if w > max_dim or h > max_dim:
                ratio = max_dim / max(w, h)
                img = img.resize(
                    (int(w * ratio), int(h * ratio)), Image.LANCZOS
                )
            # Convert RGBA/P to RGB for JPEG.
            if img.mode in ("RGBA", "P", "LA"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            return buf.getvalue(), "image/jpeg"
        except ImportError:
            # PIL missing — send original as-is.
            return image_bytes, mime
        except Exception:
            # If anything fails, send original (slightly larger but functional).
            return image_bytes, mime

    def _via_ocr(self, image_bytes: bytes) -> str:
        try:
            import io

            import pytesseract
            from PIL import Image

            img = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(img)
            cleaned = text.strip()
            if cleaned:
                return f"OCR text from screen:\n{cleaned}"
            return "[screen appears to contain no text]"
        except ImportError:
            logger.warning("pytesseract not installed; OCR unavailable")
            return "[OCR unavailable: install pytesseract and tesseract-ocr]"
        except Exception as e:
            logger.warning("OCR failed: %s", e)
            return f"[OCR error: {e}]"
