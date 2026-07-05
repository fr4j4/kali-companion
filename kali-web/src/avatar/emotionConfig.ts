import type { AvatarEmotion } from "./avatarConfig";

export const EMOTION_CONFIG = {
  toolStaleMs: 20_000,
  toolGcMs: 3_000,
  successEmotionMs: 2_000,
  errorEmotionMs: 3_000,
  /** Lifetime por emoción antes de decaer a normal (ms). Ausente = no decae. */
  emotionDecayMs: {
    enojado: 300_000,
    triste: 120_000,
    sorprendido: 8_000,
    confundido: 20_000,
    feliz: 45_000,
    ronroneando: 3_000,
  } as Partial<Record<AvatarEmotion, number>>,
  /** Inactividad progresiva. */
  idleRelaxedMs: 5 * 60_000,
  sleepMs: 15 * 60_000,
  /** Micro-variaciones en idle + normal. */
  microVariationIntervalMs: 60_000,
  microVariationProbabilities: {
    sorprendido: { chance: 0.15, everyMs: 60_000, durationMs: 1_500 },
    confundido: { chance: 0.10, everyMs: 90_000, durationMs: 2_000 },
    feliz: { chance: 0.10, everyMs: 120_000, durationMs: 2_000 },
  },
} as const;