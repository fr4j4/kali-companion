"""Single brain of the avatar: reduces core events and client signals into a PresenceFrame.

Every view (canvas, Electron floating avatar, native agent) renders the same frame, so what the
avatar *does* (activity), *feels* (emotion), *gestures*, *says* (speech envelope) and *looks at*
(attention) is decided here once. The reducer is pure apart from the injected clock, which makes
it testable with simulated time. Expression data lives in ``avatar_catalog.json``.
"""

from __future__ import annotations

import base64
import json
import re
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

CATALOG_PATH = Path(__file__).with_name("avatar_catalog.json")
PRESENCE_VERSION = 2

SOURCE_RANK = {"pet": 5, "user": 4, "llm": 3, "system": 2, "heuristic": 1}

_TOOL_OK = {"ok", "success"}
_TOOL_ERR = {"error", "err"}
_TOOL_CANCEL = {"cancelled", "canceled"}


def load_catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


# ── Text heuristics (fallback when the model emitted no [EMOTION] tag) ──────────────────────
# Applied to the LAST SENTENCE only, so "the error is fixed, done!" does not read as an error.
_ASSISTANT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("triste", re.compile(r"😔|😢|😭|\b(lamento mucho|decepcionad[oa]|triste|desolad[oa]|heartbroken|devastated)\b", re.I)),
    ("sorprendido", re.compile(r"\b(wow|incre[ií]ble|no esperaba|sorpresa|vaya|whoa|amazing|unexpected|fascinante|alucinante)\b", re.I)),
    ("confundido", re.compile(r"\b(me equivoqu[ée]|no entend[íi]|mmm|no estoy seguro|confundido|confused|unsure)(?![a-záéíóúü])", re.I)),
    ("preocupado", re.compile(r"\b(no pude|no puedo|no funcion[oó]|fall[oó]|error|failed|unable|cannot|broken)\b", re.I)),
    ("alegre", re.compile(r"😂|🤣|😊|\b(jaja|jeje|me encanta|genial|listo|completado|hecho|perfecto|resuelto|done|complete|success|finished|solved)\b", re.I)),
]
_USER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("preocupado", re.compile(r"\b(ayuda|no funciona|urgente|help|broken|stuck|wrong)\b", re.I)),
    ("alegre", re.compile(r"\b(gracias|genial|perfecto|excelente|great|thanks|awesome|perfect)\b", re.I)),
]
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…\n])\s+")


def last_sentence(text: str) -> str:
    parts = [p for p in _SENTENCE_SPLIT.split(text.strip()) if p.strip()]
    return parts[-1] if parts else ""


def heuristic_assistant(text: str) -> str | None:
    sentence = last_sentence(text)
    for emotion, rx in _ASSISTANT_PATTERNS:
        if rx.search(sentence):
            return emotion
    return None


def heuristic_user(text: str) -> str | None:
    for emotion, rx in _USER_PATTERNS:
        if rx.search(text):
            return emotion
    return None


# ── Per-session state ─────────────────────────────────────────────────────────────────────
@dataclass
class _Segment:
    segment: int
    started_at: float
    duration_ms: float
    env: str
    emotion: tuple[str, float] | None = None  # shown when this segment starts to sound
    fired: bool = False


@dataclass
class _Session:
    sid: str
    seq: int = 0
    last_activity: float = 0
    activity: str = "reposo"
    activity_since: float = 0
    activity_detail: dict[str, Any] | None = None
    turn_active: bool = False
    awaiting_text: bool = False
    last_event: float = 0
    consent_open: bool = False
    tools: dict[str, float] = field(default_factory=dict)
    tool_names: dict[str, str] = field(default_factory=dict)
    listening_until: float = 0
    typing_until: float = 0
    speech: deque[_Segment] = field(default_factory=deque)
    speech_pending: int = 0
    speech_reported: bool = False
    speech_end: float = 0
    text_tail: str = ""
    turn_had_emotion: bool = False
    emotion: dict[str, Any] = field(default_factory=lambda: {"id": "neutral", "intensity": 0.0, "since": 0, "until": 0, "source": "system"})
    emotion_remaining: float = 0
    gesture: dict[str, Any] | None = None
    gesture_queue: deque[dict[str, Any]] = field(default_factory=deque)
    gid: int = 0
    last_tick: float = 0
    last_pet: float = 0
    debug_activity: str | None = None
    debug_emotion: tuple[str, float] | None = None
    last_seen_frame: str = ""


class PresenceEngine:
    """Pure-ish reducer. ``clock`` returns milliseconds."""

    def __init__(self, catalog: dict[str, Any] | None = None, clock: Callable[[], float] | None = None) -> None:
        self.catalog = catalog or load_catalog()
        self.cfg = self.catalog["engine"]
        self.activities = self.catalog["activities"]
        self.emotions = self.catalog["emotions"]
        self.gestures = self.catalog["gestures"]
        self.clock = clock or (lambda: time.time() * 1000.0)
        self.sessions: dict[str, _Session] = {}

    # ── public API ────────────────────────────────────────────────────────────────────────
    def session(self, sid: str) -> _Session:
        s = self.sessions.get(sid)
        if s is None:
            now = self.clock()
            s = self.sessions[sid] = _Session(sid=sid, last_activity=now, activity_since=now, last_tick=now, last_event=now)
        return s

    def drop(self, sid: str) -> None:
        self.sessions.pop(sid, None)

    def apply(self, sid: str, ev: dict[str, Any]) -> bool:
        """Feed a core event. Returns True when the frame changed."""
        s = self.session(sid)
        now = self.clock()
        self._advance(s, now)
        handler = getattr(self, "_on_" + str(ev.get("event", "")), None)
        if handler is None:
            return False
        was_asleep = s.activity == "durmiendo"
        handler(s, ev, now)
        s.last_event = now
        self._touch(s, now, was_asleep)
        return self._settle(s, now)

    def signal(self, sid: str, sig: dict[str, Any]) -> bool:
        """Feed a client `presence_signal`."""
        s = self.session(sid)
        now = self.clock()
        self._advance(s, now)
        kind = sig.get("kind")
        was_asleep = s.activity == "durmiendo"
        if kind == "typing_start":
            s.typing_until = now + self.cfg["typingMs"]
        elif kind == "typing_stop":
            s.typing_until = 0
        elif kind == "pet":
            if now - s.last_pet < self.cfg["petMinIntervalMs"]:
                return False
            s.last_pet = now
            self._set_emotion(s, "carinoso", 0.8, "pet", now)
            self._gesture(s, "ronroneo", now)
        elif kind == "speech_started":
            self._speech_started(s, sig, now)
        elif kind in ("speech_ended", "speech_cancelled"):
            self._speech_ended(s, kind == "speech_cancelled", now)
        elif kind == "debug_override":
            self._debug(s, sig, now)
        else:
            return False
        self._touch(s, now, was_asleep)
        return self._settle(s, now)

    def tick(self) -> list[str]:
        """Advance time; returns session ids whose frame changed."""
        now = self.clock()
        changed = []
        for s in list(self.sessions.values()):
            self._advance(s, now)
            if self._settle(s, now):
                changed.append(s.sid)
        return changed

    def next_deadline(self) -> float | None:
        """Earliest absolute time (ms) at which a session may change by itself."""
        now = self.clock()
        best: float | None = None
        for s in self.sessions.values():
            for t in self._deadlines(s, now):
                if t > now and (best is None or t < best):
                    best = t
        return best

    def frame(self, sid: str) -> dict[str, Any]:
        s = self.session(sid)
        now = self.clock()
        self._advance(s, now)
        self._settle(s, now)
        return self._build(s, now)

    # ── event handlers ────────────────────────────────────────────────────────────────────
    def _on_ready(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = ev.get("turn_active") is True
        s.awaiting_text = s.turn_active

    def _on_user_message(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        text = ev.get("text")
        if isinstance(text, str):
            emo = heuristic_user(text)
            if emo:
                self._set_emotion(s, emo, 0.4, "system", now)

    def _on_turn_start(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = True
        s.awaiting_text = True
        s.text_tail = ""
        s.turn_had_emotion = False
        s.listening_until = 0

    def _on_reasoning_delta(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = True

    def _on_delta(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = True
        s.awaiting_text = False
        if isinstance(ev.get("text"), str):
            s.text_tail = (s.text_tail + ev["text"])[-400:]

    def _on_message(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        if ev.get("role") == "assistant" and isinstance(ev.get("text"), str):
            s.text_tail = ev["text"][-400:]

    def _on_emotion_event(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        emotion = ev.get("id") or ev.get("final")
        if emotion in self.emotions:
            s.turn_had_emotion = True
            intensity = ev.get("intensity")
            if not isinstance(intensity, (int, float)):
                intensity = self.cfg["defaultLlmIntensity"]
            self._set_emotion(s, emotion, float(intensity), "llm", now)

    def _on_turn_end(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = False
        s.awaiting_text = False
        s.consent_open = False
        s.tools.clear()
        if not s.turn_had_emotion and not ev.get("cancelled"):
            emo = heuristic_assistant(s.text_tail)
            if emo:
                self._set_emotion(s, emo, self.cfg["heuristicMaxIntensity"], "heuristic", now)

    def _on_tts_audio(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        dur = ev.get("duration")
        dur_ms = float(dur) * 1000 if isinstance(dur, (int, float)) and dur > 0 else float(self.cfg["unknownSpeechMs"])
        seg = ev.get("segment")
        # A streamed chunk continues the segment still queued: grow it with the chunk's real
        # duration and envelope (window-aligned by the core, so the bytes concatenate in time).
        if ev.get("continues") and s.speech and s.speech[-1].segment == seg:
            last = s.speech[-1]
            last.duration_ms += dur_ms
            env = ev.get("env") if isinstance(ev.get("env"), str) else ""
            if env:
                last.env = base64.b64encode(base64.b64decode(last.env or "") + base64.b64decode(env)).decode("ascii")
            s.speech_end = last.started_at + last.duration_ms
            return
        start = max(now, s.speech[-1].started_at + s.speech[-1].duration_ms if s.speech else now)
        env = ev.get("env") if isinstance(ev.get("env"), str) else ""
        emo = ev.get("emotion")
        cue = None
        if isinstance(emo, dict) and emo.get("id") in self.emotions:
            inten = emo.get("intensity")
            cue = (emo["id"], float(inten) if isinstance(inten, (int, float)) else 0.7)
            s.turn_had_emotion = True
        s.speech.append(_Segment(int(seg) if isinstance(seg, int) else len(s.speech), start, dur_ms, env, cue))
        s.speech_pending += 1
        s.speech_end = start + dur_ms

    def _on_wake_word(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.listening_until = now + self.cfg["listenMs"]

    _on_stt_partial = _on_wake_word

    def _on_stt_final(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.listening_until = 0

    def _on_consent_request(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.consent_open = True

    def _on_consent_response(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        if not s.consent_open:
            return
        s.consent_open = False
        approved = ev.get("approved", ev.get("choice") not in ("deny", "dismiss", "no", "reject"))
        self._gesture(s, "asentir" if approved else "negar", now)

    def _on_tool_event(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        cid = str(ev.get("call_id") or ev.get("tool") or "")
        status = ev.get("status")
        if status == "running":
            s.tools[cid] = now
            s.tool_names[cid] = str(ev.get("tool") or "")
            return
        s.tools.pop(cid, None)
        s.tool_names.pop(cid, None)
        s.consent_open = False
        s.awaiting_text = True
        if status in _TOOL_OK:
            if not s.tools:
                self._gesture(s, "asentir", now)
        elif status in _TOOL_ERR:
            self._gesture(s, "orejas_atras", now)
            self._set_emotion(s, "preocupado", 0.3, "system", now)
        elif status in _TOOL_CANCEL:
            self._gesture(s, "negar", now)

    def _on_error(self, s: _Session, ev: dict[str, Any], now: float) -> None:
        s.turn_active = False
        s.awaiting_text = False
        s.tools.clear()
        s.consent_open = False
        self._gesture(s, "sobresalto", now)
        self._set_emotion(s, "preocupado", 0.5, "system", now)

    # ── internals ─────────────────────────────────────────────────────────────────────────
    def _touch(self, s: _Session, now: float, was_asleep: bool) -> None:
        s.last_activity = now
        if was_asleep:
            self._gesture(s, "despertar", now)

    def _advance(self, s: _Session, now: float) -> None:
        """Move internal clocks: pause emotion decay while speaking, expire speech, run watchdogs."""
        dt = max(0.0, now - s.last_tick)
        s.last_tick = now
        speaking = self._speaking(s, now)
        if speaking and s.emotion["until"] and dt:
            s.emotion["until"] += dt
        if s.emotion["until"] and now >= s.emotion["until"]:
            s.emotion = {"id": "neutral", "intensity": 0.0, "since": now, "until": 0, "source": "system"}
        for item in s.speech:
            if not item.fired and now >= item.started_at:
                item.fired = True
                if item.emotion:
                    self._set_emotion(s, item.emotion[0], item.emotion[1], "llm", now)
        while s.speech and now >= s.speech[0].started_at + s.speech[0].duration_ms:
            s.speech.popleft()
        if s.speech_pending and not s.speech and now >= s.speech_end + self.cfg["speechTailMs"]:
            s.speech_pending = 0
            s.speech_reported = False
            if s.emotion["until"]:
                s.emotion["until"] = max(s.emotion["until"], now + self.cfg["emotionResumeMs"])
        if s.turn_active and now - s.last_event > self.cfg["thinkWatchdogMs"]:
            s.turn_active = False
            s.awaiting_text = False
        stale = [cid for cid, t in s.tools.items() if now - t > self.cfg["toolWatchdogMs"]]
        for cid in stale:
            s.tools.pop(cid, None)
        if s.listening_until and now >= s.listening_until:
            s.listening_until = 0
        if s.typing_until and now >= s.typing_until:
            s.typing_until = 0
        # Gesture expiry / queue.
        if s.gesture and now >= s.gesture["at"] + s.gesture["dur"]:
            s.gesture = None
        if s.gesture is None and s.gesture_queue:
            nxt = s.gesture_queue.popleft()
            if now - nxt["queued"] <= self.cfg["gestureStaleMs"] + nxt["dur"]:
                s.gid += 1
                s.gesture = {"id": nxt["id"], "gid": s.gid, "at": now, "dur": nxt["dur"], "prio": nxt["prio"]}

    def _speaking(self, s: _Session, now: float) -> bool:
        return bool(s.speech) and now >= s.speech[0].started_at

    def _raw_activity(self, s: _Session, now: float) -> tuple[str, dict[str, Any] | None]:
        if s.debug_activity:
            return s.debug_activity, None
        if s.consent_open:
            return "esperando", None
        if now < s.listening_until:
            return "escuchando", None
        if s.speech:
            return "hablando", None
        if s.tools:
            cid = next(reversed(s.tools))
            name = s.tool_names.get(cid)
            return "trabajando", ({"tool": name} if name else None)
        if s.turn_active and s.awaiting_text:
            return "pensando", None
        if now < s.typing_until:
            return "atento", None
        idle = now - s.last_activity
        if idle >= self.cfg["sleepMs"]:
            return "durmiendo", None
        if idle >= self.cfg["relaxedMs"]:
            return "relajado", None
        return "reposo", None

    def _resolve_activity(self, s: _Session, now: float) -> None:
        raw, detail = self._raw_activity(s, now)
        cur = s.activity
        if raw != cur:
            cur_def, raw_def = self.activities[cur], self.activities[raw]
            # A lower-priority activity waits for the current one's minimum time (hysteresis);
            # a higher-priority one interrupts at once.
            held = raw_def["priority"] < cur_def["priority"] and now - s.activity_since < cur_def["minMs"]
            if not held:
                s.activity, s.activity_since = raw, now
        s.activity_detail = detail if s.activity == raw else s.activity_detail

    def _set_emotion(self, s: _Session, emotion: str, intensity: float, source: str, now: float) -> None:
        if emotion not in self.emotions:
            return
        intensity = min(1.0, max(0.0, intensity))
        cur = s.emotion
        if cur["id"] != "neutral" and cur["until"] and SOURCE_RANK[source] < SOURCE_RANK[cur["source"]] \
                and now - cur["since"] < self.cfg["emotionCooldownMs"]:
            return
        if cur["id"] != "neutral" and SOURCE_RANK[source] < SOURCE_RANK[cur["source"]] and now < cur["until"] \
                and intensity <= cur["intensity"]:
            return
        decay = self.emotions[emotion]["decayMs"]
        if emotion == "neutral" or not decay:
            s.emotion = {"id": "neutral", "intensity": 0.0, "since": now, "until": 0, "source": source}
        else:
            s.emotion = {"id": emotion, "intensity": round(intensity, 3), "since": now, "until": now + decay, "source": source}

    def _gesture(self, s: _Session, gesture_id: str, now: float) -> None:
        g = self.gestures.get(gesture_id)
        if g is None or g["origin"] == "view":
            return  # view-origin gestures are generated locally by each view
        if s.activity == "durmiendo" and gesture_id not in ("despertar", "ronroneo"):
            return
        item = {"id": gesture_id, "dur": g["durMs"], "prio": g["priority"], "queued": now}
        cur = s.gesture
        if cur is None:
            s.gid += 1
            s.gesture = {"id": gesture_id, "gid": s.gid, "at": now, "dur": g["durMs"], "prio": g["priority"]}
        elif g["priority"] >= cur["prio"]:
            s.gid += 1
            s.gesture = {"id": gesture_id, "gid": s.gid, "at": now, "dur": g["durMs"], "prio": g["priority"]}
        elif len(s.gesture_queue) < self.cfg["gestureQueue"]:
            s.gesture_queue.append(item)

    def _speech_started(self, s: _Session, sig: dict[str, Any], now: float) -> None:
        s.speech_reported = True
        seg = sig.get("segment")
        for i, item in enumerate(s.speech):
            if item.segment == seg or (seg is None and i == 0):
                shift = now - item.started_at
                for later in list(s.speech)[i:]:
                    later.started_at += shift
                s.speech_end += shift
                break

    def _speech_ended(self, s: _Session, cancelled: bool, now: float) -> None:
        if not s.speech_reported and not cancelled:
            return
        if cancelled:
            s.speech.clear()
            s.speech_pending = 0
            s.speech_end = now
            return
        if s.speech:
            s.speech.popleft()
        s.speech_pending = max(0, s.speech_pending - 1)
        if not s.speech:
            s.speech_pending = 0

    def _debug(self, s: _Session, sig: dict[str, Any], now: float) -> None:
        if "activity" in sig:
            act = sig["activity"]
            s.debug_activity = act if act in self.activities else None
        if "emotion" in sig:
            emo = sig["emotion"]
            if emo in self.emotions:
                inten = sig.get("intensity", 1.0)
                self._set_emotion(s, emo, float(inten) if isinstance(inten, (int, float)) else 1.0, "user", now)
                s.emotion["until"] = now + 600_000 if sig.get("hold") else s.emotion["until"]
            else:
                s.emotion = {"id": "neutral", "intensity": 0.0, "since": now, "until": 0, "source": "user"}
        gesture = sig.get("gesture")
        if isinstance(gesture, str) and gesture in self.gestures:
            g = self.gestures[gesture]
            s.gid += 1
            s.gesture = {"id": gesture, "gid": s.gid, "at": now, "dur": g["durMs"], "prio": g["priority"]}

    def _deadlines(self, s: _Session, now: float) -> list[float]:
        out: list[float] = []
        if s.emotion["until"] and not self._speaking(s, now):
            out.append(s.emotion["until"])
        if s.speech:
            out.append(s.speech[0].started_at)
            out.append(s.speech[0].started_at + s.speech[0].duration_ms)
            out.extend(item.started_at for item in s.speech if not item.fired)
        if s.speech_pending and not s.speech:
            out.append(s.speech_end + self.cfg["speechTailMs"])
        if s.listening_until:
            out.append(s.listening_until)
        if s.typing_until:
            out.append(s.typing_until)
        if s.gesture:
            out.append(s.gesture["at"] + s.gesture["dur"])
        if s.turn_active:
            out.append(s.last_event + self.cfg["thinkWatchdogMs"])
        for t in s.tools.values():
            out.append(t + self.cfg["toolWatchdogMs"])
        # Held activity transitions.
        cur = self.activities[s.activity]
        if cur["minMs"]:
            out.append(s.activity_since + cur["minMs"])
        if s.activity in ("reposo", "relajado"):
            out.append(s.last_activity + self.cfg["relaxedMs"])
            out.append(s.last_activity + self.cfg["sleepMs"])
        return out

    def _settle(self, s: _Session, now: float) -> bool:
        self._resolve_activity(s, now)
        body = self._build(s, now, seq=False)
        key = json.dumps(body, sort_keys=True, separators=(",", ":"))
        if key == s.last_seen_frame:
            return False
        s.last_seen_frame = key
        s.seq += 1
        return True

    def _build(self, s: _Session, now: float, seq: bool = True) -> dict[str, Any]:
        frame: dict[str, Any] = {
            "event": "presence_state", "v": PRESENCE_VERSION, "session_id": s.sid,
            "t": int(now), "connected": True,
            "activity": {"id": s.activity, "since": int(s.activity_since)},
            "emotion": {"id": s.emotion["id"], "intensity": s.emotion["intensity"], "since": int(s.emotion["since"]),
                        "until": int(s.emotion["until"]), "source": s.emotion["source"]},
            "gesture": None, "speech": None,
            "attention": self.activities[s.activity]["attention"],
        }
        if s.activity_detail and s.activity == "trabajando":
            frame["activity"]["detail"] = s.activity_detail
        if s.gesture:
            frame["gesture"] = {"id": s.gesture["id"], "gid": s.gesture["gid"], "at": int(s.gesture["at"])}
        if s.speech:
            seg = s.speech[0]
            frame["speech"] = {"active": now >= seg.started_at, "segment": seg.segment, "started_at": int(seg.started_at),
                               "duration": int(seg.duration_ms), "env_hz": self.cfg["envHz"], "env": seg.env,
                               "estimated": not s.speech_reported}
        if seq:
            frame["seq"] = s.seq
        else:
            frame.pop("t", None)
        return frame


def encode_envelope(levels: list[int]) -> str:
    return base64.b64encode(bytes(min(255, max(0, v)) for v in levels)).decode("ascii")
