import type { AvatarEmotion } from "./avatarConfig";
import type { EmotionProvider, EmotionResult, EmotionContext } from "./EmotionProvider";
import { analyzeAssistantText } from "./textEmotionAnalyzer";

const VALID_EMOTIONS: ReadonlySet<string> = new Set([
  "normal", "enojado", "sorprendido", "ronroneando",
  "feliz", "confundido", "concentrado", "esperando", "triste",
]);

export class LLMEmotionProvider implements EmotionProvider {
  async getEmotion(ctx: EmotionContext): Promise<EmotionResult> {
    const lastEvent = ctx.emotionEvents[ctx.emotionEvents.length - 1];
    if (lastEvent?.final && VALID_EMOTIONS.has(lastEvent.final)) {
      return { emotion: lastEvent.final as AvatarEmotion, confidence: 0.9 };
    }
    if (ctx.lastAssistantText) {
      const match = analyzeAssistantText(ctx.lastAssistantText);
      if (match.confidence > 0.6 && match.emotion !== "normal") {
        return { emotion: match.emotion, confidence: match.confidence };
      }
    }
    return { emotion: null, confidence: 0 };
  }
}
