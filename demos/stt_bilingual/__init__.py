"""Bilingual STT — proof of concept.

Runs ES + EN Vosk models in parallel and merges results at the word level
by comparing per-word confidence scores on overlapping time intervals.
"""