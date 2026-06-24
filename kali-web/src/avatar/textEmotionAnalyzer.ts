/**
 * avatar/textEmotionAnalyzer.ts — Heuristic text → emotion inference.
 *
 * Analyzes assistant and user text for emotional cues (surprise, error,
 * success, frustration, gratitude) and returns a best-guess AvatarEmotion
 * with a confidence score.  Used by AvatarMoodEngine to drive contextual
 * reactions when the system state is idle or speaking.
 */

import type { AvatarEmotion } from "./avatarConfig";

export interface EmotionMatch {
  emotion: AvatarEmotion;
  confidence: number;
}

/** Patterns for English + Spanish.  Order matters — first match wins. */
const ASSISTANT_PATTERNS: Array<{ emotion: AvatarEmotion; regex: RegExp }> = [
  // Surprise — wonder, unexpected results
  { emotion: "sorprendido", regex: /\b(wow|increible|no esperaba|sorpresa|vaya|whoa|amazing|unexpected|remarkable|fascinante|alucinante)\b/i },
  // Error / failure
  { emotion: "enojado", regex: /\b(error|fallo|no funciona|problema|no puedo|imposible|failed|unable|cannot|broken|corrupt)\b/i },
  // Success / completion
  { emotion: "feliz", regex: /\b(listo|completado|hecho|exitoso|perfecto|resuelto|done|complete|success|finished|solved)\b/i },
];

const USER_PATTERNS: Array<{ emotion: AvatarEmotion; regex: RegExp }> = [
  // Frustration / help needed
  { emotion: "confundido", regex: /\b(ayuda|no funciona|error|problema|urgente|help|broken|stuck|wrong)\b/i },
  // Gratitude / satisfaction
  { emotion: "feliz", regex: /\b(gracias|genial|perfecto|excelente|great|thanks|awesome|perfect)\b/i },
];

/** Analyze the assistant's latest text for emotional cues. */
export function analyzeAssistantText(text: string): EmotionMatch {
  if (!text) return { emotion: "normal", confidence: 0.5 };
  for (const { emotion, regex } of ASSISTANT_PATTERNS) {
    if (regex.test(text)) return { emotion, confidence: 0.7 };
  }
  return { emotion: "normal", confidence: 0.5 };
}

/** Analyze the user's latest text for emotional cues. */
export function analyzeUserText(text: string): EmotionMatch {
  if (!text) return { emotion: "normal", confidence: 0.5 };
  for (const { emotion, regex } of USER_PATTERNS) {
    if (regex.test(text)) return { emotion, confidence: 0.6 };
  }
  return { emotion: "normal", confidence: 0.5 };
}