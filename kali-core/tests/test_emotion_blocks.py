"""Reply split into emotion blocks: merging of short blocks and one tts_audio per block with its emotion."""

import pytest

from kali_core.server import merge_emotion_blocks


def block(text, emotion=None, sent=False):
    return {"emotion": emotion, "intensity": 0.8 if emotion else None, "text": text, "sent": sent}


def test_short_block_folds_into_the_next_which_keeps_its_emotion():
    out = merge_emotion_blocks([block("¡Ja! ", "alegre"), block("Pero esto es bastante más largo que antes.", "triste")])
    assert len(out) == 1 and out[0]["emotion"] == "triste" and out[0]["text"].startswith("¡Ja!")


def test_short_block_lends_its_emotion_when_next_has_none():
    out = merge_emotion_blocks([block("Hola ", "alegre"), block("esta frase es larga y sin etiqueta propia.")])
    assert out[0]["emotion"] == "alegre"


def test_long_blocks_stay_and_cap_applies():
    long = "x" * 40
    out = merge_emotion_blocks([block(long, "alegre") for _ in range(12)])
    assert len(out) == 8 and out[0]["emotion"] == "alegre"
    assert sum(len(b["text"]) for b in out) == 40 * 12


def test_last_short_block_is_kept():
    out = merge_emotion_blocks([block("x" * 40, "alegre"), block("Fin.", "triste")])
    assert [b["emotion"] for b in out] == ["alegre", "triste"]


class _FakePipeline:
    voice = "v"
    mode = "m"
    provider = type("P", (), {"provider_name": "fake"})()

    def __init__(self, silent_for=()):
        self.silent_for = silent_for

    def filter_text(self, text):
        return text, text

    async def synthesize_stream(self, text):
        from kali_core.voice.providers.base import TTSResult
        if any(s in text for s in self.silent_for):
            return
        result = TTSResult(b"RIFF", 22050, 1.5)
        result.segment = 0
        yield result


class _FakeConn:
    def __init__(self, pipeline):
        self.server = type("S", (), {"tts_pipeline": pipeline})()
        self.sent = []

    async def send(self, payload):
        self.sent.append(payload)


@pytest.mark.asyncio
async def test_each_block_gets_its_own_audio_with_its_emotion():
    from kali_core.server import Connection
    conn = _FakeConn(_FakePipeline())
    blocks = [block("Primera parte bastante larga aquí.", "alegre", sent=True), block("Segunda parte también larga, claro.", "preocupado")]
    await Connection._synthesize_tts(conn, "x", "s1", blocks)
    audio = [p for p in conn.sent if p["event"] == "tts_audio"]
    assert [p["segment"] for p in audio] == [0, 1]
    assert [p["emotion"]["id"] for p in audio] == ["alegre", "preocupado"]


@pytest.mark.asyncio
async def test_block_without_audio_still_shows_its_emotion():
    from kali_core.server import Connection
    conn = _FakeConn(_FakePipeline(silent_for=("Segunda",)))
    blocks = [block("Primera parte bastante larga aquí.", "alegre", sent=True), block("Segunda parte también larga, claro.", "preocupado")]
    await Connection._synthesize_tts(conn, "x", "s1", blocks)
    assert any(p["event"] == "emotion_event" and p["id"] == "preocupado" for p in conn.sent)


@pytest.mark.asyncio
async def test_untagged_reply_is_synthesized_as_before():
    from kali_core.server import Connection
    conn = _FakeConn(_FakePipeline())
    await Connection._synthesize_tts(conn, "Hola, esto no lleva etiquetas.", "s1", [block("Hola, esto no lleva etiquetas.")])
    audio = [p for p in conn.sent if p["event"] == "tts_audio"]
    assert len(audio) == 1 and "emotion" not in audio[0]
