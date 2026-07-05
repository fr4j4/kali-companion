import type { AvatarEmotion } from "./avatarConfig";
import type { ToolEvent } from "../lib/protocol";

export interface EmotionResult {
  emotion: AvatarEmotion | null;
  confidence: number;
  continuous?: { valence: number; arousal: number };
}

export interface EmotionContext {
  emotionEvents: Array<{ final: string | null }>;
  toolEvents: ToolEvent[];
  chatError: string | null;
  now: number;
  lastAssistantText: string;
}

export interface EmotionProvider {
  getEmotion(ctx: EmotionContext): Promise<EmotionResult>;
}
