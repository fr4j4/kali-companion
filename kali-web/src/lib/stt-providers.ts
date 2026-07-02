export const STT_PROVIDERS = {
  VOSK: "vosk",
  QWEN3: "qwen3-asr",
} as const;

export type SttProviderId = (typeof STT_PROVIDERS)[keyof typeof STT_PROVIDERS];

export const STT_PROVIDER_IDS: readonly SttProviderId[] = [
  STT_PROVIDERS.VOSK,
  STT_PROVIDERS.QWEN3,
];

export function isSttProviderId(val: string): val is SttProviderId {
  return (STT_PROVIDER_IDS as readonly string[]).includes(val);
}

export const DEFAULT_STT_PROVIDER = STT_PROVIDERS.VOSK;
