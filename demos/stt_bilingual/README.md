# Bilingual STT Demo

Proof of concept for dual-model Vosk STT with word-level merge.

## What it does

Runs **Spanish (ES)** and **English (EN)** Vosk models **in parallel** on the
same audio. At the end, compares per-word confidence scores on overlapping
time intervals and picks the best word for each segment.

This handles mixed-language speech like:

> "qué build le hago a sniper"

- ES model might hear "qué build le hago a es una dotados" (low conf on "sniper")
- EN model might hear "que bill lehago a sniper" (low conf on Spanish words)
- **Merged** result picks each word from whichever model had higher confidence:
  "qué" (ES) + "build" (ES) + "le" (ES) + "hago" (ES) + "a" (ES) + "sniper" (EN)

## Quick start

```bash
# Install deps (use the kali-core venv if available)
pip install -r requirements.txt

# Run with microphone
python demo.py

# Run with a WAV file (16kHz or any rate, 16-bit, mono)
python demo.py --file audio.wav

# Adjust confidence floor (default 0.4)
python demo.py --floor 0.3

# Debug: run only one model
python demo.py --es-only
python demo.py --en-only
```

## How the merge works

1. Both models produce word-level results with timestamps:
   ```
   {word: "sniper", start: 0.85, end: 1.10, conf: 0.88}
   ```
2. All time boundaries are collected and sorted.
3. For each sub-interval between consecutive boundaries, the active word
   from each model is found.
4. The word with higher confidence wins that sub-interval (if above the
   confidence floor).
5. Consecutive segments won by the same word are merged into one output
   word. This correctly handles the case where one model hears a single
   long word and the other hears two shorter words for the same span.

## Files

| File | Description |
|------|-------------|
| `bilingual_stt.py` | `BilingualSTT` class + merge algorithm |
| `record.py` | Mic recording (`sounddevice`) or WAV loading |
| `demo.py` | Interactive entry point |
| `requirements.txt` | Python dependencies |

## Vosk models

Models must be in `kali-core/kali_core/ear/models/`. The demo automatically
finds them there. Override with:

```bash
export VOSK_MODELS_DIR=/path/to/models
```

## Limitations

- This is a PoC — audio TTS (robotic) doesn't transcribe well with either
  model. Real human speech works much better.
- The merge is per-utterance (single `FinalResult`). If the audio has long
  pauses, Vosk splits it into multiple utterances with relative timestamps.
  Each utterance should be merged independently (not implemented in this demo).
- The confidence floor is a heuristic. Too high → valid words discarded.
  Too low → garbage kept. Experiment with `--floor`.