# Avatar animation system

One brain, many views. The core decides what the avatar does; every client only renders.

## Layers

- `kali-core/kali_core/avatar_catalog.json` is the single source of truth: channels, activities, emotions,
  gestures, mouth shapes, symbols and the performance profiles. `kali-web/scripts/gen-avatar-catalog.mjs`
  (`npm run gen:avatar`) turns it into `src/avatar/avatarCatalog.gen.ts`; a test fails when they drift.
- `presence_engine.py` reduces core events and `presence_signal`s into a `presence_state` v2 frame
  (activity, emotion, gesture, speech envelope, attention). See `PROTOCOL.md`.
- `mind/emotion_filter.py` removes `[EMOTION: id 0.7]` tags from the LLM stream (aliases such as `feliz` map to
  canonical ids) and `emotion_prompt.py` tells the model how to use them.
- `kali-web/src/avatar/rig/` composes the frame into channel targets (neutral + activity + emotion x intensity
  x fade + gesture), smooths them with critically damped springs and paints through `SvgRenderer`.
  Blinks, breathing, whiskers, gaze and view-only idle gestures (yawn, look around, ear flick) are local.

## Emotion and voice

`[EMOTION]` tags are block boundaries for the TTS: each stretch of text is spoken with its own emotion, shown when
its audio begins (`server.py` `_synthesize_tts`, `PresenceEngine` segment `emotion`). Tags should open a sentence;
the prompt asks for at most one per paragraph. Without TTS the emotions apply as the text streams.

## Adding an expression

Add the emotion or gesture to the catalog (deltas are over the channels listed there), run `npm run gen:avatar`,
and run `pytest tests/test_presence_engine.py tests/test_emotion_filter.py` and `npx vitest run`.
Brows stay invisible unless the avatar is expressing; tool use is the `trabajando` activity, never an angry face.

## Performance and accessibility

`<html data-perf-profile>` (quality 60 fps, balanced 30, performance 20) and `data-reduced-motion` are read by
every view, including the Electron floating window and the native agent's WebView. Reduced motion (Settings >
Appearance > Avatar motion, or the OS preference) removes breathing, gestures, gaze following and oscillation
and keeps expressions. The avatar is a focusable button with a live aria-label and announces only waiting and
offline states.

## Debugging

In dev, the debug pad has activity, emotion and gesture buttons that send `presence_signal` `debug_override`.
