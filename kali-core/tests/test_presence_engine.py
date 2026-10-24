"""PresenceEngine: event/signal sequences -> PresenceFrame, with a simulated clock."""

from __future__ import annotations

import base64
import io
import json
import wave

import pytest

from kali_core.presence import tts_envelope
from kali_core.presence_engine import PresenceEngine, heuristic_assistant, heuristic_user, load_catalog


class Clock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, ms: float) -> None:
        self.t += ms


@pytest.fixture()
def rig():
    clock = Clock()
    return PresenceEngine(clock=clock), clock


def act(engine, sid="s"):
    return engine.frame(sid)["activity"]["id"]


def emo(engine, sid="s"):
    return engine.frame(sid)["emotion"]["id"]


def test_catalog_is_complete():
    cat = load_catalog()
    channels = set(cat["channels"])
    for name, a in cat["activities"].items():
        assert set(a["delta"]) <= channels, name
        assert a["attention"] in cat["attentions"] and a["tone"] in cat["haloTones"]
    for name, e in cat["emotions"].items():
        assert set(e["delta"]) <= channels, name
        assert e["mouth"] in cat["mouthShapes"] and e["symbol"] in cat["symbols"], name
        assert e["description"] and e["label"]
    for name, g in cat["gestures"].items():
        assert g["durMs"] > 0 and g["tracks"], name
        for tr in g["tracks"]:
            assert tr["ch"] in channels, name
            assert "keys" in tr or "osc" in tr
    assert set(cat["idleGestures"]) <= set(cat["gestures"])
    assert {"neutral", "alegre", "molesto", "orgulloso", "travieso"} <= set(cat["emotions"])


def test_tool_running_is_working_not_angry(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    assert act(e) == "pensando"
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a", "tool": "bash"})
    frame = e.frame("s")
    assert frame["activity"]["id"] == "trabajando" and frame["activity"]["detail"] == {"tool": "bash"}
    assert frame["emotion"]["id"] == "neutral"  # the old "judge stare" bug
    assert frame["attention"] == "work"


def test_tool_ok_nods_and_error_flattens_ears(rig):
    e, c = rig
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a"})
    c.advance(700)
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "a"})
    assert e.frame("s")["gesture"]["id"] == "asentir"
    c.advance(2000)
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "b"})
    e.apply("s", {"event": "tool_event", "status": "error", "call_id": "b"})
    f = e.frame("s")
    assert f["gesture"]["id"] == "orejas_atras" and f["emotion"]["id"] == "preocupado"
    assert f["emotion"]["intensity"] == pytest.approx(0.3)


def test_multi_tool_nods_only_when_last_finishes(rig):
    e, c = rig
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a"})
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "b"})
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "a"})
    assert e.frame("s")["gesture"] is None
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "b"})
    assert e.frame("s")["gesture"]["id"] == "asentir"


def test_hysteresis_between_working_and_thinking(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a"})
    c.advance(100)
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "a"})
    assert act(e) == "trabajando"  # held for minMs
    assert e.next_deadline() is not None
    c.advance(600)
    e.tick()
    assert act(e) == "pensando"


def test_text_ends_thinking_and_turn_end_returns_to_rest(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    c.advance(500)
    e.apply("s", {"event": "delta", "text": "Hola"})
    c.advance(500)
    assert act(e) == "reposo"
    e.apply("s", {"event": "turn_end"})
    assert act(e) == "reposo"


def test_consent_waits_and_gesture_follows_answer(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", {"event": "consent_request"})
    assert act(e) == "esperando"
    e.apply("s", {"event": "consent_response", "approved": False})
    assert e.frame("s")["gesture"]["id"] == "negar"
    c.advance(450)  # "esperando" is held for its minimum time
    e.tick()
    assert act(e) != "esperando"


def test_speech_timeline_and_emotion_pause(rig):
    e, c = rig
    e.apply("s", {"event": "emotion_event", "id": "alegre", "intensity": 0.8})
    until = e.frame("s")["emotion"]["until"]
    e.apply("s", {"event": "tts_audio", "duration": 2.0, "segment": 0, "env": "AAEC"})
    f = e.frame("s")
    assert f["activity"]["id"] == "hablando" and f["speech"]["env"] == "AAEC" and f["speech"]["estimated"] is True
    c.advance(1000)
    assert act(e) == "hablando"
    c.advance(1200)
    e.tick()
    assert act(e) != "hablando" or e.frame("s")["speech"] is not None
    c.advance(400)
    e.tick()
    assert act(e) == "reposo"
    # Emotion decay was paused while speaking: it now outlives the original deadline.
    assert e.frame("s")["emotion"]["until"] > until


def test_client_speech_signals_reanchor_and_end(rig):
    e, c = rig
    e.apply("s", {"event": "tts_audio", "duration": 5.0, "segment": 0})
    c.advance(300)
    e.signal("s", {"kind": "speech_started", "segment": 0})
    assert e.frame("s")["speech"]["estimated"] is False
    c.advance(1000)
    e.signal("s", {"kind": "speech_ended", "segment": 0})
    e.tick()
    assert act(e) == "reposo"


def test_speech_cancelled_closes_immediately(rig):
    e, c = rig
    e.apply("s", {"event": "tts_audio", "duration": 5.0})
    e.signal("s", {"kind": "speech_cancelled"})
    c.advance(350)
    e.tick()
    assert act(e) == "reposo"


def test_listening_priority_and_timeout(rig):
    e, c = rig
    e.apply("s", {"event": "tts_audio", "duration": 5.0})
    e.apply("s", {"event": "wake_word"})
    assert act(e) == "escuchando"  # barge-in beats speaking
    e.apply("s", {"event": "stt_final"})
    assert act(e) == "hablando"
    e.apply("s", {"event": "stt_partial"})
    c.advance(8100)
    e.tick()
    assert act(e) != "escuchando"


def test_typing_signal_gives_attentive_activity(rig):
    e, c = rig
    e.signal("s", {"kind": "typing_start"})
    f = e.frame("s")
    assert f["activity"]["id"] == "atento" and f["attention"] == "input"
    c.advance(4100)
    e.tick()
    assert act(e) == "reposo"
    e.signal("s", {"kind": "typing_start"})
    e.signal("s", {"kind": "typing_stop"})
    assert act(e) == "reposo"


def test_pet_purrs_and_is_rate_limited(rig):
    e, c = rig
    assert e.signal("s", {"kind": "pet"})
    f = e.frame("s")
    assert f["gesture"]["id"] == "ronroneo" and f["emotion"]["id"] == "carinoso" and f["emotion"]["source"] == "pet"
    c.advance(500)
    assert e.signal("s", {"kind": "pet"}) is False
    c.advance(3000)
    e.tick()
    assert e.frame("s")["gesture"] is None
    assert e.signal("s", {"kind": "pet"})


def test_pet_ends_by_itself(rig):
    e, c = rig
    e.signal("s", {"kind": "pet"})
    c.advance(5000)
    e.tick()
    assert emo(e) == "neutral"


def test_emotion_tag_sets_emotion_and_beats_heuristic(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", {"event": "emotion_event", "id": "orgulloso", "intensity": 0.6})
    e.apply("s", {"event": "delta", "text": "Hay un error, pero lo resolví."})
    e.apply("s", {"event": "turn_end"})
    f = e.frame("s")
    assert f["emotion"]["id"] == "orgulloso" and f["emotion"]["source"] == "llm"


def test_unknown_emotion_ignored(rig):
    e, c = rig
    e.apply("s", {"event": "emotion_event", "id": "gruñón"})
    assert emo(e) == "neutral"


def test_heuristic_fallback_is_weak_and_uses_last_sentence(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", {"event": "delta", "text": "El error estaba en la línea 3. Ya quedó todo listo!"})
    e.apply("s", {"event": "turn_end"})
    f = e.frame("s")
    assert f["emotion"]["id"] == "alegre" and f["emotion"]["intensity"] <= 0.4 and f["emotion"]["source"] == "heuristic"
    assert heuristic_assistant("Todo bien. Hubo un error.") == "preocupado"
    assert heuristic_assistant("Hola") is None


def test_user_text_empathy(rig):
    e, c = rig
    e.apply("s", {"event": "user_message", "text": "no funciona nada, ayuda"})
    assert emo(e) == "preocupado"  # empathy, never "confused" nor "angry"
    assert heuristic_user("muchas gracias") == "alegre"


def test_emotion_cooldown_and_source_priority(rig):
    e, c = rig
    e.apply("s", {"event": "emotion_event", "id": "triste", "intensity": 0.8})
    c.advance(200)
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "x"})
    e.apply("s", {"event": "tool_event", "status": "error", "call_id": "x"})  # system(preocupado) < llm
    assert emo(e) == "triste"
    c.advance(200)
    e.signal("s", {"kind": "pet"})  # pet beats everything
    assert emo(e) == "carinoso"


def test_emotion_decays_back_to_neutral(rig):
    e, c = rig
    e.apply("s", {"event": "emotion_event", "id": "sorprendido"})
    assert emo(e) == "sorprendido"
    c.advance(2600)
    e.tick()
    assert emo(e) == "neutral"


def test_error_event_startles_and_ends_turn(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", {"event": "error", "detail": "x"})
    f = e.frame("s")
    assert f["gesture"]["id"] == "sobresalto" and f["emotion"]["id"] == "preocupado"
    c.advance(450)
    e.tick()
    assert act(e) == "reposo"


def test_gesture_priority_and_queue(rig):
    e, c = rig
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "b"})
    e.apply("s", {"event": "tool_event", "status": "error", "call_id": "b"})  # orejas_atras prio 4
    first = e.frame("s")["gesture"]["gid"]
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a"})
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "a"})  # asentir prio 3 -> queued
    assert e.frame("s")["gesture"]["gid"] == first
    c.advance(1000)
    e.tick()
    g = e.frame("s")["gesture"]
    assert g is not None and g["id"] == "asentir" and g["gid"] > first


def test_stale_queued_gesture_is_dropped(rig):
    e, c = rig
    e.signal("s", {"kind": "pet"})
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "a"})
    e.apply("s", {"event": "tool_event", "status": "ok", "call_id": "a"})
    c.advance(10_000)
    e.tick()
    assert e.frame("s")["gesture"] is None


def test_idle_relaxes_sleeps_and_wakes_with_gesture(rig):
    e, c = rig
    e.frame("s")
    c.advance(300_000)
    e.tick()
    assert act(e) == "relajado"
    c.advance(600_000)
    e.tick()
    assert act(e) == "durmiendo"
    e.apply("s", {"event": "user_message", "text": "hola"})
    f = e.frame("s")
    assert f["activity"]["id"] == "reposo" and f["gesture"]["id"] == "despertar"


def test_sleep_blocks_most_gestures(rig):
    e, c = rig
    e.frame("s")
    c.advance(900_000)
    e.tick()
    assert act(e) == "durmiendo"
    e.signal("s", {"kind": "typing_start"})  # wakes
    assert e.frame("s")["gesture"]["id"] == "despertar"


def test_watchdogs(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    c.advance(91_000)
    e.tick()
    assert act(e) == "reposo"
    e.apply("s", {"event": "tool_event", "status": "running", "call_id": "z"})
    c.advance(21_000)
    e.tick()
    assert act(e) != "trabajando"


def test_snapshot_on_reconnect_mid_turn(rig):
    e, c = rig
    e.apply("s", {"event": "ready", "turn_active": True})
    assert act(e) == "pensando"


def test_debug_override(rig):
    e, c = rig
    e.signal("s", {"kind": "debug_override", "activity": "durmiendo", "emotion": "molesto", "hold": True})
    f = e.frame("s")
    assert f["activity"]["id"] == "durmiendo" and f["emotion"]["id"] == "molesto"
    e.signal("s", {"kind": "debug_override", "activity": None})
    assert act(e) == "reposo"


def test_seq_changes_only_when_frame_changes(rig):
    e, c = rig
    s1 = e.frame("s")["seq"]
    c.advance(1000)
    assert e.tick() == []
    assert e.frame("s")["seq"] == s1
    e.signal("s", {"kind": "typing_start"})
    assert e.frame("s")["seq"] == s1 + 1


def test_sessions_are_independent(rig):
    e, c = rig
    e.apply("a", {"event": "turn_start"})
    assert act(e, "a") == "pensando" and act(e, "b") == "reposo"


def test_frame_is_json_serialisable(rig):
    e, c = rig
    e.apply("s", {"event": "tts_audio", "duration": 1, "env": "AQI="})
    json.dumps(e.frame("s"))


def _wav(seconds: float, rate: int = 8000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            amp = 12000 if (i // (rate // 10)) % 2 == 0 else 600
            frames += int(amp * (1 if i % 2 else -1)).to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return base64.b64encode(buf.getvalue()).decode()


def test_tts_envelope_follows_energy():
    env = base64.b64decode(tts_envelope({"audio": _wav(1.0)}, hz=20))
    assert len(env) == 20
    loud, quiet = env[0], env[3]
    assert loud > 200 and quiet < loud * 0.6


def test_tts_envelope_handles_garbage():
    assert tts_envelope({"audio": "not-base64!!"}) == ""
    assert tts_envelope({}) == ""


def _audio(emotion=None, seg=0, dur=2.0):
    ev = {"event": "tts_audio", "duration": dur, "segment": seg, "env": ""}
    if emotion:
        ev["emotion"] = {"id": emotion, "intensity": 0.9}
    return ev


def test_emotion_rides_on_the_audio_and_appears_when_it_sounds(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", _audio("alegre", 0))
    e.apply("s", _audio("preocupado", 1))
    e.tick()
    assert emo(e) == "alegre"
    c.advance(1900)
    e.tick()
    assert emo(e) == "alegre"
    c.advance(300)
    e.tick()
    assert emo(e) == "preocupado"
    assert e.next_deadline() is not None


def test_pending_audio_emotion_is_dropped_when_speech_is_cancelled(rig):
    e, c = rig
    e.apply("s", _audio("alegre", 0))
    e.apply("s", _audio("triste", 1))
    e.tick()
    e.signal("s", {"kind": "speech_started", "segment": 0})
    e.signal("s", {"kind": "speech_cancelled"})
    c.advance(5000)
    e.tick()
    assert emo(e) != "triste"


def test_audio_emotion_beats_the_end_of_turn_heuristic(rig):
    e, c = rig
    e.apply("s", {"event": "turn_start"})
    e.apply("s", _audio("orgulloso", 0))
    e.apply("s", {"event": "message", "role": "assistant", "text": "Lo siento mucho, falló."})
    e.apply("s", {"event": "turn_end"})
    assert e.frame("s")["emotion"]["id"] in ("orgulloso", "neutral")
    assert e.frame("s")["emotion"]["id"] != "triste"
