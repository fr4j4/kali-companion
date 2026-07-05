"""Tests for emotion_prompt module."""

from kali_core.mind.emotion_prompt import build_emotion_prompt_fragment


def test_emotion_prompt_includes_all_catalog_emotions():
    fragment = build_emotion_prompt_fragment()
    assert "<emotion:" in fragment
    for emotion_id in [
        "normal",
        "enojado",
        "sorprendido",
        "ronroneando",
        "feliz",
        "confundido",
        "concentrado",
        "esperando",
    ]:
        assert emotion_id in fragment


def test_emotion_prompt_includes_example():
    fragment = build_emotion_prompt_fragment()
    assert "Ejemplo" in fragment


def test_emotion_prompt_is_a_string():
    fragment = build_emotion_prompt_fragment()
    assert isinstance(fragment, str)
    assert len(fragment) > 0


def test_emotion_prompt_contains_instruction():
    fragment = build_emotion_prompt_fragment()
    assert "Puedes expresar" in fragment
