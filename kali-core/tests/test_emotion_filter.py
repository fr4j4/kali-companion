"""EmotionStreamFilter: [EMOTION: id 0.7] tags are stripped from the stream and reported at once."""

import pytest

from kali_core.mind.emotion_filter import EmotionStreamFilter, strip_tags
from kali_core.mind.emotion_prompt import build_emotion_prompt_fragment, emotion_tag_enabled
from kali_core.mind.marker_suppressor import MarkerSuppressor
from kali_core.presence_engine import load_catalog


def run(chunks):
    f = EmotionStreamFilter()
    out = "".join(f.feed(c) for c in chunks) + f.flush()
    return out, f.drain()


def test_tag_at_start_is_reported_and_removed():
    out, ev = run(["[EMOTION: alegre] ¡Hola!"])
    assert out == "¡Hola!" and ev == [("alegre", None)]


def test_intensity():
    out, ev = run(["[EMOTION: triste 0.35] Lo siento."])
    assert out == "Lo siento." and ev == [("triste", 0.35)]
    _, ev = run(["[EMOTION: alegre 7]"])
    assert ev == [("alegre", 1.0)]  # clamped


def test_event_is_available_before_the_rest_of_the_text():
    f = EmotionStreamFilter()
    assert f.feed("[EMOTION: curioso] Mm") == "Mm"
    assert f.drain() == [("curioso", None)]  # the avatar can react before the voice starts
    assert f.drain() == []


def test_tag_in_the_middle_and_end():
    out, ev = run(["Hola [EMOTION: alegre] ¿Cómo estás? ", "[EMOTION: curioso]"])
    assert out == "Hola ¿Cómo estás? " and [e for e, _ in ev] == ["alegre", "curioso"]


def test_unknown_label_is_discarded_but_removed():
    out, ev = run(["Hola [EMOTION: melancolico] mundo"])
    assert out == "Hola mundo" and ev == []


def test_aliases_map_legacy_and_english_ids():
    _, ev = run(["[EMOTION: feliz]", "[EMOTION: Enojado]", "[EMOTION: happy]", "[EMOTION: cariñoso]"])
    assert [e for e, _ in ev] == ["alegre", "molesto", "alegre", "carinoso"]


@pytest.mark.parametrize("emotion", sorted(load_catalog()["emotions"]))
def test_every_catalog_emotion_is_accepted(emotion):
    out, ev = run([f"texto [EMOTION: {emotion}] fin"])
    assert out == "texto fin" and ev == [(emotion, None)]


def test_split_one_character_at_a_time():
    text = "Antes [EMOTION: orgulloso 0.9] después."
    out, ev = run(list(text))
    assert out == "Antes después." and ev == [("orgulloso", 0.9)]


@pytest.mark.parametrize("split", ["[", "[EM", "[EMOTION", "[EMOTION:", "[EMOTION: fe"])
def test_split_inside_the_marker(split):
    full = "Hola [EMOTION: feliz] fin"
    i = full.index("[EMOTION") + len(split)
    out, ev = run([full[:i], full[i:]])
    assert out == "Hola fin" and ev == [("alegre", None)]


def test_bracketed_text_that_is_not_a_tag_is_kept():
    out, ev = run(["lista[0] y [EMAIL", " protegido] ok"])
    assert out == "lista[0] y [EMAIL protegido] ok" and ev == []


def test_trailing_open_bracket_released_on_flush():
    out, _ = run(["array["])
    assert out == "array["


def test_unterminated_tag_is_dropped_on_flush():
    out, ev = run(["hola [EMOTION: ale"])
    assert out == "hola " and ev == []


def test_no_double_space_around_tag():
    out, _ = run(["a ", "[EMOTION: alegre]", " b"])
    assert out == "a b"
    out, _ = run(["Texto [EMOTION: alegre]Fin"])
    assert out == "Texto Fin"


def test_reset():
    f = EmotionStreamFilter()
    f.feed("[EMOTION: alegre] x")
    f.reset()
    assert f.drain() == [] and f.feed("y") == "y"


def test_strip_tags_defence_in_depth():
    assert strip_tags("Hola [EMOTION: alegre 0.5] mundo [EMOTION: x]") == "Hola  mundo"
    assert strip_tags("sin etiquetas") == "sin etiquetas"


def test_chain_with_marker_suppressor_keeps_tags_split_by_it():
    suppressor = MarkerSuppressor("[TOOL_CALL:")
    f = EmotionStreamFilter()
    out = []
    for chunk in ["Hola [", "EMOTION: ale", "gre 0.8] mundo"]:
        safe = suppressor.feed(chunk)
        if safe:
            out.append(f.feed(safe))
    tail = suppressor.flush()
    out.append(f.feed(tail) if tail else "")
    out.append(f.flush())
    assert "".join(out) == "Hola mundo" and f.drain() == [("alegre", 0.8)]


def test_prompt_fragment_lists_all_emotions_and_is_switchable(monkeypatch):
    fragment = build_emotion_prompt_fragment()
    for emotion in load_catalog()["emotions"]:
        assert f"- {emotion}:" in fragment
    assert "[EMOTION:" in fragment and len(fragment) < 2500
    monkeypatch.setenv("KALI_AVATAR_EMOTION_TAG", "0")
    assert emotion_tag_enabled() is False
    monkeypatch.delenv("KALI_AVATAR_EMOTION_TAG")
    assert emotion_tag_enabled() is True


def test_marks_report_where_each_tag_stood_in_the_returned_text():
    f = EmotionStreamFilter()
    text = f.feed("Hola. [EMOTION: alegre] Qué bien. [EMOTION: triste 0.5]Adiós")
    marks = f.drain_marks()
    assert [(m[0], m[1]) for m in marks] == [("alegre", None), ("triste", 0.5)]
    assert text[: marks[0][2]] == "Hola. " and text[marks[0][2]: marks[1][2]].strip() == "Qué bien."
    assert f.drain_marks() == [] and f.drain() == []
