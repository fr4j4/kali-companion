"""PCM streaming helpers: window-aligned chunking, live mouth envelope, binary frames.

The Qwen engine streams raw s16le mono PCM. The core re-cuts it into chunks whose
length is a whole number of envelope windows (1/env_hz s), so the envelope bytes of
consecutive chunks concatenate exactly in time, and computes each chunk's real
duration and envelope as it arrives. Nothing is estimated.
"""

from __future__ import annotations

import base64
import struct
from array import array
from collections.abc import Iterator

# Binary WebSocket frame sent to the client for each chunk:
#   u8 kind (1 = TTS PCM chunk), u8 flags (bit0 = final), u16 seq,
#   u32 block_id, u32 segment, u32 sample_rate, then s16le mono PCM.
# Little endian, 16 bytes, so the PCM stays 2-byte aligned for an Int16Array view.
FRAME_KIND_TTS_PCM = 1
FRAME_FLAG_FINAL = 1
_HEADER = struct.Struct("<BBHIII")
HEADER_SIZE = _HEADER.size

# Starting reference for the running peak, so the first windows of a segment are not
# all normalised to full open. Typical speech RMS is well under this.
_PEAK_SEED = 0.12 * 32767


def encode_frame(block_id: int, segment: int, seq: int, sample_rate: int, pcm: bytes, final: bool) -> bytes:
    flags = FRAME_FLAG_FINAL if final else 0
    return _HEADER.pack(FRAME_KIND_TTS_PCM, flags, seq & 0xFFFF, block_id, segment, sample_rate) + pcm


def decode_frame(data: bytes) -> dict:
    kind, flags, seq, block_id, segment, rate = _HEADER.unpack_from(data)
    return {"kind": kind, "final": bool(flags & FRAME_FLAG_FINAL), "seq": seq, "block_id": block_id,
            "segment": segment, "sample_rate": rate, "pcm": data[HEADER_SIZE:]}


def pcm_duration(pcm: bytes, sample_rate: int) -> float:
    return len(pcm) / 2 / sample_rate if sample_rate > 0 else 0.0


class PcmChunker:
    """Re-cut a byte stream into chunks of whole envelope windows.

    ``feed`` yields every complete multiple of ``window`` samples held so far (at
    least ``min_windows``); ``flush`` returns the remainder (the only chunk that may
    end in a partial window), so envelope windows never straddle two chunks.
    """

    def __init__(self, sample_rate: int, env_hz: int, min_windows: int = 1) -> None:
        self.window_bytes = max(1, sample_rate // max(1, env_hz)) * 2
        self.min_bytes = self.window_bytes * max(1, min_windows)
        self._buf = bytearray()

    def feed(self, data: bytes) -> Iterator[bytes]:
        self._buf += data
        if len(self._buf) < self.min_bytes:
            return
        cut = len(self._buf) - len(self._buf) % self.window_bytes
        out = bytes(self._buf[:cut])
        del self._buf[:cut]
        yield out

    def flush(self) -> bytes:
        rest = bytes(self._buf[: len(self._buf) - len(self._buf) % 2])
        self._buf.clear()
        return rest


class LiveEnvelope:
    """Mouth-energy envelope of one segment, computed chunk by chunk.

    Same measure as ``presence.tts_envelope`` (RMS per 1/hz window, gamma 0.7), but
    normalised to the running peak of the segment instead of its final peak, which
    is unknown while streaming. One reference for the whole segment, so there are no
    jumps where chunks join.
    """

    def __init__(self, sample_rate: int, env_hz: int) -> None:
        self.window = max(1, sample_rate // max(1, env_hz))
        self.peak = _PEAK_SEED

    def chunk(self, pcm: bytes) -> str:
        samples = array("h")
        samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
        if not samples:
            return ""
        step = max(1, self.window // 32)
        raw: list[float] = []
        for start in range(0, len(samples), self.window):
            part = samples[start:start + self.window:step]
            if not part:
                break
            raw.append((sum(v * v for v in part) / len(part)) ** 0.5)
        self.peak = max(self.peak, *raw)
        return base64.b64encode(bytes(min(255, int(255 * (v / self.peak) ** 0.7)) for v in raw)).decode("ascii")
