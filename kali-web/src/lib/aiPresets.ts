export interface ProviderPreset {
  id: string;
  label: string;
  labelEs: string;
  kind: "local" | "cloud";
  apiUrl: string;
  requiresApiKey: boolean;
  apiKeyHint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "ollama_local",
    label: "Ollama (Local)",
    labelEs: "Ollama (Local)",
    kind: "local",
    apiUrl: "http://127.0.0.1:11434/v1",
    requiresApiKey: false,
  },
  {
    id: "llama_cpp",
    label: "llama.cpp",
    labelEs: "llama.cpp",
    kind: "local",
    apiUrl: "http://127.0.0.1:8080/v1",
    requiresApiKey: false,
  },
  {
    id: "unsloth",
    label: "Unsloth",
    labelEs: "Unsloth",
    kind: "local",
    apiUrl: "http://127.0.0.1:8000/v1",
    requiresApiKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    labelEs: "LM Studio",
    kind: "local",
    apiUrl: "http://127.0.0.1:1234/v1",
    requiresApiKey: false,
  },
  {
    id: "vllm",
    label: "vLLM",
    labelEs: "vLLM",
    kind: "local",
    apiUrl: "http://127.0.0.1:8000/v1",
    requiresApiKey: false,
  },
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    labelEs: "Ollama Cloud",
    kind: "cloud",
    apiUrl: "https://ollama.com/v1",
    requiresApiKey: true,
    apiKeyHint: "ollama.com API key",
  },
  {
    id: "openai",
    label: "OpenAI",
    labelEs: "OpenAI",
    kind: "cloud",
    apiUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    apiKeyHint: "sk-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    labelEs: "OpenRouter",
    kind: "cloud",
    apiUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    apiKeyHint: "openrouter key",
  },
  {
    id: "custom",
    label: "Custom",
    labelEs: "Personalizado",
    kind: "cloud",
    apiUrl: "",
    requiresApiKey: false,
  },
];

export interface LocalEndpoint {
  port: number;
  url: string;
  vendor: string;
  models: string[];
}

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function getDefaultPreset(): ProviderPreset {
  return PROVIDER_PRESETS[0];
}
