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
  // Tristeza / dolor — emoción intensa, detectar primero
  { emotion: "triste", regex: /😔|😢|😭|\b(decepcionad[oa]|triste|desolad[oa]|abatid[oa]|heartbroken|devastated)\b/i },
  // Sorpresa — asombro, resultado inesperado
  { emotion: "sorprendido", regex: /\b(wow|increible|no esperaba|sorpresa|vaya|whoa|amazing|unexpected|remarkable|fascinante|alucinante|oooh)\b|\bah!|\bvaya!/i },
  // Confusión / disculpa / duda
  { emotion: "confundido", regex: /\b(me equivoqu[ée]|no entend[íi]|disculpa|mmm|no estoy seguro|confundido|confused|unsure|doubt)(?![a-záéíóúü])/i },
  // Error / frustración / enfado (técnico)
  { emotion: "enojado", regex: /\b(error|fallo|no funciona|problema|no puedo|imposible|failed|unable|cannot|broken|corrupt|frustrad|enojad|molesto|irritad)\b/i },
  // Risa / diversión — patrones no ambiguos de alegría
  { emotion: "feliz", regex: /😂|🤣|\b(jaja|ja ja|jeje|me encanta|divertido|genial|listo|completado|hecho|exitoso|perfecto|resuelto|done|complete|success|finished|solved)\b/i },
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