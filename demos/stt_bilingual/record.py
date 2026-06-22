"""Audio recording — capture from mic or load a WAV file.

Returns raw 16kHz 16-bit signed mono PCM bytes, ready for Vosk.
"""

from __future__ import annotations

import sys
import wave


def record_from_mic(max_seconds: float = 10.0) -> bytes:
    """Record audio from the microphone until Enter is pressed or timeout.

    Returns raw PCM bytes (16kHz, 16-bit, mono, little-endian).
    """
    import sounddevice as sd
    import numpy as np

    print()
    print("🎤 Press ENTER to start recording (or Ctrl+C to quit)...")
    input()
    print("🔴 Recording... Press ENTER to stop.", flush=True)

    # Use a stream callback to accumulate audio.
    chunks: list[np.ndarray] = []

    def callback(indata, frames, time_info, status):
        chunks.append(indata.copy())

    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        dtype="int16",
        channels=1,
        callback=callback,
        blocksize=1024,
    )
    stream.start()

    try:
        # Wait for Enter or max_seconds.
        import select
        import time

        start = time.time()
        while True:
            # Check if stdin has data (Enter pressed).
            if select.select([sys.stdin], [], [], 0.1)[0]:
                sys.stdin.readline()
                break
            if time.time() - start > max_seconds:
                print(f"\n⏱ Max recording time ({max_seconds}s) reached.")
                break
    except KeyboardInterrupt:
        pass
    finally:
        stream.stop()
        stream.close()

    if not chunks:
        print("⚠ No audio captured.")
        return b""

    audio = np.concatenate(chunks, axis=0)
    print(f"✅ Captured {len(audio) / SAMPLE_RATE:.1f}s of audio.")

    # Convert to raw bytes (int16 → little-endian).
    return audio.tobytes()


def load_wav(path: str) -> bytes:
    """Load a WAV file and return raw PCM bytes.

    The WAV must be 16kHz, 16-bit, mono. If the format doesn't match,
    we try to convert it.
    """
    import numpy as np

    print(f"📁 Loading WAV: {path}")

    with wave.open(path, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    print(
        f"   Format: {framerate}Hz, {sampwidth * 8}-bit, {n_channels}ch, "
        f"{n_frames / framerate:.1f}s"
    )

    # Convert to int16 numpy array.
    if sampwidth == 2:
        audio = np.frombuffer(raw, dtype=np.int16)
    elif sampwidth == 1:
        audio = np.frombuffer(raw, dtype=np.uint8).astype(np.int16) * 256
    elif sampwidth == 4:
        audio = np.frombuffer(raw, dtype=np.int32)
        audio = (audio >> 16).astype(np.int16)
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")

    # If stereo, take first channel.
    if n_channels > 1:
        audio = audio[::n_channels]

    # Resample to 16kHz if needed.
    if framerate != SAMPLE_RATE:
        print(f"   Resampling from {framerate} to {SAMPLE_RATE}Hz...")
        ratio = SAMPLE_RATE / framerate
        new_length = int(len(audio) * ratio)
        indices = np.linspace(0, len(audio) - 1, new_length).astype(int)
        audio = audio[indices]

    print(f"   Final: {len(audio) / SAMPLE_RATE:.1f}s at {SAMPLE_RATE}Hz")
    return audio.tobytes()


# Import SAMPLE_RATE from bilingual_stt to avoid duplication.
from bilingual_stt import SAMPLE_RATE  # noqa: E402