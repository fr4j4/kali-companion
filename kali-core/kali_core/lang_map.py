"""Language code normalization — maps regional codes to project codes.

The project internally uses simple 2-letter codes (``"es"``, ``"en"``) for
STT model selection, TTS voices, and tool context.  External sources (env
vars, frontend settings, API calls) may provide full BCP-47 tags such as
``"es-CL"``, ``"en-US"``, etc.  This module normalises them so the rest of
the codebase never sees an unsupported code.
"""

from __future__ import annotations

# Map of known regional codes → project-internal code.
# Add entries here as needed.
_LANG_MAP: dict[str, str] = {
    "es-CL": "es",
    "es-ES": "es",
    "es-MX": "es",
    "es-US": "es",
    "en-US": "en",
    "en-GB": "en",
}

# The set of codes the project natively understands.
_SUPPORTED = frozenset({"es", "en"})


def normalize(lang: str) -> str:
    """Normalise a language code to a project-internal code.

    Examples::

        normalize("es-CL")  → "es"
        normalize("es")     → "es"
        normalize("en-US")  → "en"
        normalize("fr")     → "en"   (fallback)
        normalize("")        → "en"   (fallback)
    """
    if not lang:
        return "en"

    # 1. Direct lookup in the regional map.
    if lang in _LANG_MAP:
        return _LANG_MAP[lang]

    # 2. Already a supported simple code.
    if lang in _SUPPORTED:
        return lang

    # 3. Try extracting the primary language subtag (before the first "-").
    parts = lang.split("-", maxsplit=1)
    if parts[0] in _SUPPORTED:
        return parts[0]

    # 4. Fallback.
    return "en"
