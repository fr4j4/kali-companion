"""Streamed TTS: window-aligned chunks, live envelope, presence continuation, per-block emotion."""

import base64
import io
import math
import struct
import wave

import pytest

from kali_core.presence import tts_envelope
from kali_core.presence_engine import PresenceEngine
from kali_core.voice.pipeline import PcmPiece, TTSPipeline
from kali_core.voice.providers.base import TTSResult
from kali_core.voice.streaming import (
    HEADER_SIZE, LiveEnvelope, PcmChunker, decode_frame, encode_frame, pcm_duration,
)

RATE = 24000
HZ = 20


def tone(seconds: float, amp: float = 8000.0) -> bytes:
    n = int(RATE * seconds)
    # Syllable-like loudness changes, so the envelope is not flat.
    return struct.pack(f"<{n}h", *(int(amp * (0.3 + 0.7 * abs(math.sin(i / 3000))) * math.sin(i / 7)) for i in range(n)))


def wav(pcm: bytes) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return base64.b64encode(buf.getvalue()).decode()


# ── chunker + envelope ───────────────────────────────────────────────────────────────────
def test_chunker_cuts_whole_windows_and_keeps_every_byte():
    pcm = tone(1.234)
    ch = PcmChunker(RATE, HZ)
    out = []
    for i in range(0, len(pcm), 3001):  # odd network pieces, even mid-sample
        out.extend(ch.feed(pcm[i:i + 3001]))
    window = RATE // HZ * 2
    assert out and all(len(c) % window == 0 for c in out)
    tail = ch.flush()
    assert b"".join(out) + tail == pcm


def test_streamed_envelope_joins_without_seams_and_matches_the_whole_one():
    pcm = tone(2.0)
    ch, live = PcmChunker(RATE, HZ), LiveEnvelope(RATE, HZ)
    env = b""
    for i in range(0, len(pcm), 2500):
        for c in ch.feed(pcm[i:i + 2500]):
            env += base64.b64decode(live.chunk(c))
    env += base64.b64decode(live.chunk(ch.flush()))
    whole = base64.b64decode(tts_envelope({"audio": wav(pcm)}, HZ))
    assert len(env) == len(whole)  # one byte per window, in time
    # Same shape; only the running peak can make early windows a bit more open.
    late = slice(len(env) // 2, None)
    assert max(abs(a - b) for a, b in zip(env[late], whole[late])) <= 3
    assert all(a >= b - 3 for a, b in zip(env, whole))


def test_frame_round_trip():
    f = encode_frame(3, 7, 2, RATE, b"\x01\x00\xff\xff", final=True)
    assert len(f) == HEADER_SIZE + 4
    d = decode_frame(f)
    assert d == {"kind": 1, "final": True, "seq": 2, "block_id": 3, "segment": 7, "sample_rate": RATE, "pcm": b"\x01\x00\xff\xff"}
    assert pcm_duration(b"\x00" * 4800, RATE) == pytest.approx(0.1)


# ── presence engine ───────────────────────────────────────────────────────────────────────
class Clock:
    t = 1_000_000.0

    def __call__(self):
        return self.t


def test_continuation_grows_the_segment_with_real_duration_and_envelope():
    c = Clock()
    e = PresenceEngine(clock=c)
    e.apply("s", {"event": "tts_audio", "segment": 0, "duration": 0.1, "env": base64.b64encode(b"\x10\x20").decode(),
                  "emotion": {"id": "alegre", "intensity": 0.9}})
    e.apply("s", {"event": "tts_audio", "segment": 0, "duration": 0.2, "env": base64.b64encode(b"\x30\x40\x50\x60").decode(),
                  "continues": True})
    sp = e.frame("s")["speech"]
    assert sp["duration"] == 300
    assert base64.b64decode(sp["env"]) == b"\x10\x20\x30\x40\x50\x60"
    e.tick()
    assert e.frame("s")["emotion"]["id"] == "alegre"


def test_streamed_block_emotion_fires_like_a_whole_segment():
    """Same emotion timeline whether segment 0 arrives whole or as 4 chunks."""
    def run(chunked):
        c = Clock()
        e = PresenceEngine(clock=c)
        e.apply("s", {"event": "turn_start"})
        if chunked:
            for k in range(4):
                ev = {"event": "tts_audio", "segment": 0, "duration": 0.5, "env": "", "continues": k > 0}
                if k == 0:
                    ev["emotion"] = {"id": "alegre", "intensity": 0.9}
                e.apply("s", ev)
        else:
            e.apply("s", {"event": "tts_audio", "segment": 0, "duration": 2.0, "env": "", "emotion": {"id": "alegre", "intensity": 0.9}})
        e.apply("s", {"event": "tts_audio", "segment": 1, "duration": 1.0, "env": "", "emotion": {"id": "preocupado", "intensity": 0.9}})
        seen = []
        for step in range(30):
            e.tick()
            seen.append(e.frame("s")["emotion"]["id"])
            c.t += 100
        return seen
    assert run(True) == run(False)


# ── server: one emotion block, streamed ──────────────────────────────────────────────────
class _Provider:
    provider_name = "qwen3"
    supports_streaming = True
    sample_rate = RATE

    def __init__(self, fail_for=()):
        self.fail_for = fail_for

    async def synthesize_pcm(self, text, voice, mode="normal", language="auto"):
        if any(s in text for s in self.fail_for):
            raise RuntimeError("no audio")
            yield b""  # pragma: no cover
        pcm = tone(0.33)
        for i in range(0, len(pcm), 4000):
            yield pcm[i:i + 4000]

    async def synthesize(self, text, voice, mode="normal", language="auto"):
        return TTSResult(b"RIFF", RATE, 0.5)


class _Conn:
    def __init__(self, provider):
        from kali_core.server import PresenceEngine as PE
        pipeline = TTSPipeline(provider, voice="serena")
        mirrored = self.mirrored = []

        class S:
            tts_pipeline = pipeline
            presence = PE()

            async def mirror_presence(self, sid, payload):
                mirrored.append(payload)

        self.server = S()
        self.sent = []
        self.frames = []

    async def send(self, payload):
        self.sent.append(payload)

    async def send_bytes(self, data):
        self.frames.append(decode_frame(data))

    async def _speak_block_streamed(self, *a):
        from kali_core.server import Connection
        return await Connection._speak_block_streamed(self, *a)


def block(text, emotion=None, sent=False):
    return {"emotion": emotion, "intensity": 0.8 if emotion else None, "text": text, "sent": sent}


@pytest.mark.asyncio
async def test_streamed_blocks_keep_emotion_on_first_audio_and_order():
    from kali_core.server import Connection
    conn = _Conn(_Provider())
    blocks = [block("Primera parte bastante larga aquí.", "alegre", sent=True), block("Segunda parte también larga, claro.", "preocupado")]
    await Connection._synthesize_tts(conn, "x", "s1", blocks)
    events = [p["event"] for p in conn.sent]
    assert events == ["tts_block_start", "tts_block_end", "tts_block_start", "tts_block_end"]
    assert [p["emotion"]["id"] for p in conn.sent if p["event"] == "tts_block_start"] == ["alegre", "preocupado"]
    assert all(p["status"] == "done" for p in conn.sent if p["event"] == "tts_block_end")
    # Emotion only on the first audio of each block, segments in order, real durations.
    with_emotion = [(p["block_id"], p["emotion"]["id"]) for p in conn.mirrored if "emotion" in p]
    assert with_emotion == [(0, "alegre"), (1, "preocupado")]
    assert [p["continues"] for p in conn.mirrored if p["block_id"] == 0][0] is False
    assert sorted({p["segment"] for p in conn.mirrored}) == [0, 1]
    total = sum(p["duration"] for p in conn.mirrored if p["segment"] == 0)
    assert total == pytest.approx(0.33, abs=1 / RATE)
    # Client frames: per segment seq 0.., exactly one final at the end.
    for seg in (0, 1):
        fr = [f for f in conn.frames if f["segment"] == seg]
        assert [f["seq"] for f in fr] == list(range(len(fr)))
        assert [f["final"] for f in fr] == [False] * (len(fr) - 1) + [True]


@pytest.mark.asyncio
async def test_failed_stream_falls_back_to_wav_and_keeps_the_emotion():
    from kali_core.server import Connection
    conn = _Conn(_Provider(fail_for=("Segunda",)))
    blocks = [block("Primera parte bastante larga aquí.", "alegre", sent=True), block("Segunda parte también larga, claro.", "preocupado")]
    await Connection._synthesize_tts(conn, "x", "s1", blocks)
    wav_events = [p for p in conn.sent if p["event"] == "tts_audio"]
    assert len(wav_events) == 1 and wav_events[0]["emotion"]["id"] == "preocupado" and wav_events[0]["segment"] == 1


@pytest.mark.asyncio
async def test_block_without_audio_ends_empty_and_shows_its_emotion():
    from kali_core.server import Connection

    class Silent(_Provider):
        async def synthesize(self, *a, **k):
            raise RuntimeError("nothing")

    conn = _Conn(Silent(fail_for=("Segunda",)))
    blocks = [block("Primera parte bastante larga aquí.", "alegre", sent=True), block("Segunda parte también larga, claro.", "preocupado")]
    await Connection._synthesize_tts(conn, "x", "s1", blocks)
    assert any(p["event"] == "emotion_event" and p["id"] == "preocupado" for p in conn.sent)
    assert conn.sent[-1] == {"event": "tts_block_end", "session_id": "s1", "block_id": 1, "status": "empty"}


@pytest.mark.asyncio
async def test_stream_can_be_turned_off(monkeypatch):
    from kali_core import server as srv
    monkeypatch.setattr(srv.settings, "tts_stream", False)

    class P(_Provider):
        async def synthesize(self, text, voice, mode="normal", language="auto"):
            return TTSResult(b"RIFF", RATE, 0.5)

    conn = _Conn(P())
    await srv.Connection._synthesize_tts(conn, "x", "s1", [block("Primera parte bastante larga aquí.", "alegre")])
    assert [p["event"] for p in conn.sent] == ["tts_audio"] and not conn.frames


def test_pcm_piece_defaults():
    assert PcmPiece(0, b"").final is False
