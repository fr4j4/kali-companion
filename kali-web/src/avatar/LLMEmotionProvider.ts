import type { AvatarEmotion } from "./avatarConfig";
import type { EmotionProvider, EmotionResult, EmotionContext } from "./EmotionProvider";

const VALID_EMOTIONS: ReadonlySet<string> = new Set([
  "normal", "enojado", "sorprendido", "ronroneando",
  "feliz", "confundido", "concentrado", "esperando",
]);

export class LLMEmotionProvider implements EmotionProvider {
  async getEmotion(ctx: EmotionContext): Promise<EmotionResult> {
    const lastEvent = ctx.emotionEvents[ctx.emotionEvents.length - 1];
    if (!lastEvent || !lastEvent.final) {
      return { emotion: null, confidence: 0 };
    }
    const raw = lastEvent.final;
    if (!VALID_EMOTIONS.has(raw)) {
      return { emotion: "normal", confidence: 0.5 };
    }
    return { emotion: raw as AvatarEmotion, confidence: 0.9 };
  }
}
