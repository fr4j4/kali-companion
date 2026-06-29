export const TTS_PROVIDERS = {
  PIPER: "piper",
  QWEN3: "qwen3",
  HTTP: "http",
  UNAVAILABLE: "unavailable",
} as const;

export type TtsProviderId = (typeof TTS_PROVIDERS)[keyof typeof TTS_PROVIDERS];

export const TTS_PROVIDER_IDS: readonly TtsProviderId[] = [
  TTS_PROVIDERS.PIPER,
  TTS_PROVIDERS.QWEN3,
  TTS_PROVIDERS.HTTP,
  TTS_PROVIDERS.UNAVAILABLE,
];

export function isTtsProviderId(val: string): val is TtsProviderId {
  return (TTS_PROVIDER_IDS as readonly string[]).includes(val);
}

export const DEFAULT_TTS_PROVIDER = TTS_PROVIDERS.PIPER;
