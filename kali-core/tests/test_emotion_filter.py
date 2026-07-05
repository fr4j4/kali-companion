"""Tests for EmotionStreamFilter."""

import pytest
from kali_core.mind.emotion_filter import EmotionStreamFilter


class TestEmotionStreamFilter:
    def test_single_emotion_at_end(self):
        f = EmotionStreamFilter()
        assert f.feed("Hola mundo") == "Hola mundo"
        assert f.feed(" <emotion:feliz/>") == ""
        assert f.flush() == ["feliz"]

    def test_no_emotion_block(self):
        f = EmotionStreamFilter()
        assert f.feed("Hola mundo") == "Hola mundo"
        assert f.flush() == []

    def test_invalid_emotion_discarded(self):
        f = EmotionStreamFilter()
        assert f.feed("Hola <emotion:melancolico/> mundo") == "Hola mundo"
        assert f.flush() == []

    def test_emotion_in_middle(self):
        f = EmotionStreamFilter()
        assert f.feed("Hola <emotion:feliz/> ¿Cómo estás?") == "Hola ¿Cómo estás?"
        assert f.flush() == ["feliz"]

    def test_split_block_across_chunks(self):
        f = EmotionStreamFilter()
        assert f.feed("texto <emotion:fe") == "texto "
        assert f.feed("liz/> resto") == " resto"
        assert f.flush() == ["feliz"]

    def test_multiple_emotions(self):
        f = EmotionStreamFilter()
        assert f.feed("<emotion:concentrado/> ... ") == " ... "
        assert f.feed("<emotion:feliz/>") == ""
        assert f.flush() == ["concentrado", "feliz"]

    def test_flush_releases_residual(self):
        f = EmotionStreamFilter()
        assert f.feed("texto <emotion:esperando") == "texto "
        assert f.flush() == []

    def test_empty_chunk(self):
        f = EmotionStreamFilter()
        assert f.feed("") == ""
        assert f.feed("hola") == "hola"
        assert f.flush() == []

    def test_reset_clears_state(self):
        f = EmotionStreamFilter()
        assert f.feed("Hola <emotion:feliz/>") == "Hola"
        assert f.flush() == ["feliz"]
        f.reset()
        assert f.feed("Otro <emotion:enojado/>") == "Otro"
        assert f.flush() == ["enojado"]

    def test_valid_emotions_all_accepted(self):
        valid = ["normal", "enojado", "sorprendido", "ronroneando", "feliz", "confundido", "concentrado", "esperando"]
        for emotion in valid:
            f = EmotionStreamFilter()
            result = f.feed(f"texto <emotion:{emotion}/> fin")
            assert result == "texto fin", f"Failed for {emotion}"
            assert f.flush() == [emotion], f"Flush failed for {emotion}"

    def test_emotion_block_no_trailing_space(self):
        f = EmotionStreamFilter()
        assert f.feed("Texto <emotion:feliz/>Fin") == "TextoFin"
        assert f.flush() == ["feliz"]

    def test_multiple_emotions_same_chunk(self):
        f = EmotionStreamFilter()
        assert f.feed("a <emotion:concentrado/> b <emotion:feliz/> c") == "a b c"
        assert f.flush() == ["concentrado", "feliz"]
