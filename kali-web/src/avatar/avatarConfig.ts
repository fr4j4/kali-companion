/**
 * avatar/avatarConfig.ts — Types and persistence for avatar customization.
 *
 * The avatar mascot supports 3 species (cat/dog/hedgehog), multiple breeds,
 * color customization, eye colors, neck accessories, glasses, and hats.
 * Configuration is persisted to localStorage and applied on load.
 */

export type AvatarSpecies = "gato" | "perro" | "erizo";
export type EarType = "cat" | "dog-up" | "dog-flop" | "hedgehog";
export type NeckAccessory =
  | "cascabel"
  | "placa"
  | "corazon"
  | "corbatin"
  | "flor"
  | "estrella"
  | "bufanda"
  | "ninguno";
export type GlassesType = "none" | "round" | "square";
export type HatType = "none" | "gorro" | "copa" | "fiesta";

/** Avatar visual state driven by the mood engine. */
export type AvatarState = "idle" | "escuchando" | "pensando" | "hablando";
export type AvatarEmotion =
  | "normal"
  | "enojado"
  | "sorprendido"
  | "ronroneando"
  | "feliz"
  | "confundido";

/** Full avatar configuration (persistable). */
export interface AvatarConfig {
  species: AvatarSpecies;
  breed: string;
  ears: EarType;
  pattern: string;
  colors: { base: string; spot1: string; spot2: string; ears: string };
  eyes: { light: string; main: string; dark: string; pupil: string };
  accessory: NeckAccessory;
  glasses: GlassesType;
  hat: HatType;
  collar: string;
  hatColor: string;
  glassesColor: string;
}

/** Default config — calico cat with green eyes and a bell. */
export const DEFAULT_CONFIG: AvatarConfig = {
  species: "gato",
  breed: "calico",
  ears: "cat",
  pattern: "pattern-calico-1",
  colors: { base: "#FFFFFF", spot1: "#E5954B", spot2: "#211E1F", ears: "#211E1F" },
  eyes: { light: "#E8F196", main: "#95C23D", dark: "#4A7314", pupil: "#0D0D0D" },
  accessory: "cascabel",
  glasses: "none",
  hat: "none",
  collar: "#D33C37",
  hatColor: "#3B82F6",
  glassesColor: "#1F2937",
};

const STORAGE_KEY = "kali.avatar_config";

/** Load config from localStorage, falling back to defaults. */
export function loadAvatarConfig(): AvatarConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save config to localStorage. */
export function saveAvatarConfig(config: AvatarConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore quota errors */
  }
}

/** Reset config to defaults and clear storage. */
export function resetAvatarConfig(): AvatarConfig {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}