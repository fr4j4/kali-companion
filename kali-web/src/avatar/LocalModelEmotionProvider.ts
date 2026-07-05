import type { EmotionProvider, EmotionResult, EmotionContext } from "./EmotionProvider";

/**
 * Placeholder for future local emotion inference model.
 * Not implemented — always returns normal (R3).
 * The UI toggle allows selecting it but does not change visible behaviour.
 */
export class LocalModelEmotionProvider implements EmotionProvider {
  async getEmotion(_ctx: EmotionContext): Promise<EmotionResult> {
    return { emotion: "normal", confidence: 0 };
  }
}
