"""Tests for EmotionStreamFilter."""

import pytest
from kali_core.mind.emotion_filter import EmotionStreamFilter
from kali_core.mind.marker_suppressor import MarkerSuppressor


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

    def test_block_split_before_full_prefix(self):
        """Regression: LLM splits <emotion:ronroneando/> so that <em
        arrives in one chunk and the rest in the next. The filter must
        retain <em (a partial prefix of <emotion:) and not emit it."""
        f = EmotionStreamFilter()
        assert f.feed("Hola <em") == "Hola "
        assert f.feed("otion:ronroneando/>") == ""
        assert f.flush() == ["ronroneando"]

    def test_block_split_single_char_prefix(self):
        """Regression: LLM emits just '<' then 'emotion:feliz/>'."""
        f = EmotionStreamFilter()
        assert f.feed("Texto <") == "Texto "
        assert f.feed("emotion:feliz/>") == ""
        assert f.flush() == ["feliz"]

    def test_block_split_mid_prefix(self):
        """Regression: split at <emo."""
        f = EmotionStreamFilter()
        assert f.feed("Test <emo") == "Test "
        assert f.feed("tion:enojado/>") == ""
        assert f.flush() == ["enojado"]

    def test_partial_prefix_not_emotion_is_released(self):
        """If the buffer ends with <em but the next chunk is not 'otion:',
        the <em should be released as visible text (it's not an emotion tag)."""
        f = EmotionStreamFilter()
        out1 = f.feed("Hola <em")
        assert out1 == "Hola ", f"Expected 'Hola ', got {out1!r}"
        out2 = f.feed("ail me back")
        # <em + ail = <email, not <emotion: → released as visible text
        assert "<email" in out2 or out2.endswith("ail me back"), f"Got {out2!r}"
        assert f.flush() == []


class TestEmotionFilterWithMarkerSuppressor:
    """Integration tests: MarkerSuppressor + EmotionStreamFilter chained.

    Reproduces the real pipeline where MarkerSuppressor retains up to
    len(marker)-1 chars at the end of each chunk, which can split
    <emotion:.../> blocks across chunk boundaries. The emotion_filter
    must still capture the emotion when the retained text is fed via
    flush().
    """

    def test_emotion_block_split_by_marker_suppressor_flush(self):
        """Regression: <emotion:ronroneando/> at end of stream, split
        by MarkerSuppressor's hold-back. The flush must pass through
        the emotion_filter so the block is reassembled and captured."""
        marker = MarkerSuppressor("[TOOL_CALL:")
        emo = EmotionStreamFilter()

        # Simulate the LLM emitting text + emotion block at the very end.
        # MarkerSuppressor will hold back the last 10 chars.
        full_text = "¡Tu emprendimiento se merece una página tan única! <emotion:ronroneando/>"

        # Feed through MarkerSuppressor (simulates one big chunk from LLM).
        safe = marker.feed(full_text)

        # The emotion_filter receives whatever the MarkerSuppressor emitted.
        # The last 10 chars are retained by MarkerSuppressor, so the
        # emotion block is likely split.
        emo.feed(safe)

        # Now flush the MarkerSuppressor — this releases the held-back tail.
        # This tail MUST pass through the emotion_filter (the bug was that
        # it skipped the emotion_filter and went directly to output).
        tail = marker.flush()
        assert tail, "MarkerSuppressor should have retained some text"
        emo.feed(tail)

        # The emotion_filter should now have captured the full block.
        emotions = emo.flush()
        assert emotions == ["ronroneando"], f"Expected ['ronroneando'], got {emotions}"

    def test_emotion_block_not_leaked_as_visible_text(self):
        """After the fix, no part of <emotion:.../> should appear in the
        text that reaches the UI (the safe output)."""
        marker = MarkerSuppressor("[TOOL_CALL:")
        emo = EmotionStreamFilter()

        full_text = "¡Quedó hermoso! <emotion:ronroneando/>"
        safe = marker.feed(full_text)
        visible_during_stream = emo.feed(safe)

        tail = marker.flush()
        if tail:
            visible_from_flush = emo.feed(tail)
        else:
            visible_from_flush = ""

        all_visible = visible_during_stream + visible_from_flush
        assert "<emotion:" not in all_visible, f"Emotion block leaked: {all_visible!r}"
        assert "ronroneando/>" not in all_visible, f"Emotion block leaked: {all_visible!r}"
        assert emo.flush() == ["ronroneando"]
