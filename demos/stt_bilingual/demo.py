#!/usr/bin/env python3
"""Demo: Bilingual STT with word-level merge.

Usage:
    cd demos/stt_bilingual
    python demo.py                    # Record from mic
    python demo.py --file audio.wav   # Use a WAV file
    python demo.py --floor 0.3        # Adjust confidence floor
    python demo.py --en-only          # Only English model (debug)
    python demo.py --es-only          # Only Spanish model (debug)

Shows:
    - ES model raw result (text + per-word confidence)
    - EN model raw result (text + per-word confidence)
    - Merged result (word-level by confidence)
    - Detailed merge decisions

Requires: vosk, sounddevice, numpy
Models must be in kali-core/kali_core/ear/models/
"""

from __future__ import annotations

import argparse
import os
import sys

# Ensure local imports work.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bilingual_stt import BilingualSTT, ModelResult, Word, MergeDecision, _extract_result
from record import record_from_mic, load_wav


def print_separator(title: str, char: str = "─", width: int = 60) -> None:
    print()
    print(f" {title} ".center(width, char))


def print_model_result(title: str, result: ModelResult) -> None:
    """Pretty-print a single model's result with per-word details."""
    print_separator(title)
    print(f'\n  Text: "{result.text}"')
    print(f"  Avg confidence: {result.avg_confidence:.2f}")
    print(f"  Words ({len(result.words)}):")
    print()
    print(f"    {'word':<20} {'start':>6} {'end':>6} {'conf':>6} {'source':>6}")
    print(f"    {'─' * 20} {'─' * 6} {'─' * 6} {'─' * 6} {'─' * 6}")
    for w in result.words:
        marker = " ← LOW" if w.conf < 0.5 else ""
        print(
            f"    {w.word:<20} {w.start:>6.2f} {w.end:>6.2f} "
            f"{w.conf:>6.2f} {w.source:>6}{marker}"
        )


def print_merge_result(
    es: ModelResult,
    en: ModelResult,
    merged: list[Word],
    decisions: list[MergeDecision],
) -> None:
    """Pretty-print the merged result and decision details."""
    merged_text = " ".join(w.word for w in merged)

    print_separator("MERGED RESULT (word-level by confidence)", "═")
    print(f'\n  Final text: "{merged_text}"')
    print(f"  Words: {len(merged)}")
    print()

    # Decision table.
    print("  Per-word decisions:")
    print()
    print(
        f"    {'final':<16} {'start':>6} {'end':>6} {'conf':>6} "
        f"{'src':>4}  {'ES word':<16} {'ES conf':>8}  {'EN word':<16} {'EN conf':>8}"
    )
    print(f"    {'─' * 16} {'─' * 6} {'─' * 6} {'─' * 6} {'─' * 4}  {'─' * 16} {'─' * 8}  {'─' * 16} {'─' * 8}")

    for d in decisions:
        es_str = f"{d.es_conf:.2f}" if d.es_conf is not None else "—"
        en_str = f"{d.en_conf:.2f}" if d.en_conf is not None else "—"
        es_word = d.es_word or "—"
        en_word = d.en_word or "—"
        print(
            f"    {d.final:<16} {d.start:>6.2f} {d.end:>6.2f} {d.conf:>6.2f} "
            f"{d.source:>4}  {es_word:<16} {es_str:>8}  {en_word:<16} {en_str:>8}"
        )

    # Summary.
    print()
    es_words = sum(1 for d in decisions if d.source == "es")
    en_words = sum(1 for d in decisions if d.source == "en")
    print(f"  Summary: {es_words} from ES, {en_words} from EN, {len(decisions)} total")


def print_comparison(
    es_text: str,
    en_text: str,
    merged_text: str,
) -> None:
    """Print a side-by-side comparison of all three outputs."""
    print_separator("COMPARISON", "═")
    print()
    print(f"  ES only:      \"{es_text}\"")
    print(f"  EN only:      \"{en_text}\"")
    print(f"  MERGED:       \"{merged_text}\"")
    print()


def run_single_model(
    audio: bytes,
    model_name: str,
    source: str,
) -> ModelResult:
    """Run audio through a single Vosk model."""
    import json
    import vosk

    from bilingual_stt import _load_model, SAMPLE_RATE

    model = _load_model(model_name)
    rec = vosk.KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(True)

    # Feed in chunks of ~100ms.
    chunk_size = int(SAMPLE_RATE * 0.1) * 2  # 16-bit = 2 bytes/sample
    for i in range(0, len(audio), chunk_size):
        rec.AcceptWaveform(audio[i:i + chunk_size])

    raw = json.loads(rec.FinalResult())
    return _extract_result(raw, source)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bilingual STT demo with word-level merge"
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="Path to a WAV file (16kHz, 16-bit, mono). If omitted, records from mic.",
    )
    parser.add_argument(
        "--floor",
        type=float,
        default=0.4,
        help="Confidence floor — words below this are discarded (default: 0.4)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=10.0,
        help="Max recording time when using mic (default: 10s)",
    )
    parser.add_argument(
        "--en-only",
        action="store_true",
        help="Run only the English model (debug)",
    )
    parser.add_argument(
        "--es-only",
        action="store_true",
        help="Run only the Spanish model (debug)",
    )
    args = parser.parse_args()

    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║     Bilingual STT Demo — ES + EN word-level merge       ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  Confidence floor: {args.floor}")

    # Get audio.
    if args.file:
        if not os.path.isfile(args.file):
            print(f"❌ File not found: {args.file}")
            sys.exit(1)
        audio = load_wav(args.file)
    else:
        audio = record_from_mic(max_seconds=args.max_seconds)

    if not audio:
        print("❌ No audio to process.")
        sys.exit(1)

    duration = len(audio) / 2 / 16000  # 2 bytes/sample, 16kHz
    print(f"  Audio duration: {duration:.1f}s")
    print(f"  PCM bytes: {len(audio)}")

    # Run models.
    if args.en_only:
        print_separator("Running EN model only", "─")
        en_result = run_single_model(audio, "vosk-model-small-en-us-0.15", "en")
        print_model_result("English Model Result", en_result)
        print()
        return

    if args.es_only:
        print_separator("Running ES model only", "─")
        es_result = run_single_model(audio, "vosk-model-small-es-0.42", "es")
        print_model_result("Spanish Model Result", es_result)
        print()
        return

    # Bilingual mode.
    print_separator("Loading models", "─")
    stt = BilingualSTT(confidence_floor=args.floor)
    stt.start()

    print_separator("Processing audio through both models", "─")
    chunk_size = int(16000 * 0.1) * 2  # 100ms chunks
    for i in range(0, len(audio), chunk_size):
        stt.feed(audio[i:i + chunk_size])

    es_result, en_result, merged, decisions = stt.finish()

    # Print results.
    print_model_result("Spanish Model (ES)", es_result)
    print_model_result("English Model (EN)", en_result)
    print_merge_result(es_result, en_result, merged, decisions)

    merged_text = " ".join(w.word for w in merged)
    print_comparison(es_result.text, en_result.text, merged_text)

    # Hint for the user.
    print("💡 Try saying mixed phrases like:")
    print('   "qué build le hago a sniper"')
    print('   "voy mid con pudge"')
    print('   "el invoker es muy fuerte"')
    print()


if __name__ == "__main__":
    main()