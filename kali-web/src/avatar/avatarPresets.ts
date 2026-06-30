/**
 * avatar/avatarPresets.ts — Multi-species breed/pattern/variation database.
 *
 * Ported from the v7 POC customizer (v7/customizer.js animalDatabase) to
 * TypeScript with full type safety.  Used by CustomizerDrawer to populate
 * breed buttons, variation buttons, color picker labels, and preset colors.
 */

import type { AvatarSpecies, EarType } from "./avatarConfig";

/** A single variation of a breed — includes a pattern id, color presets. */
export interface Variation {
  id: string;
  name: string;
  activePickers: ("base" | "spot1" | "spot2" | "ears")[];
  labels: Partial<Record<"base" | "spot1" | "spot2" | "ears", string>>;
  preset: {
    base: string;
    s1: string;
    s2: string;
    ears: string;
    eyeL: string;
    eyeM: string;
    eyeD: string;
    pupil: string;
  };
}

/** A breed within a species — has a name, optional custom ears, and variations. */
export interface Breed {
  name: string;
  isCustom?: boolean;
  ears?: EarType;
  variations: Variation[];
}

/** A species — has default ears and a map of breeds. */
export interface Species {
  ears: EarType;
  breeds: Record<string, Breed>;
}

/** The full database. */
export const animalDatabase: Record<AvatarSpecies, Species> = {
  gato: {
    ears: "cat",
    breeds: {
      calico: {
        name: "Calico",
        variations: [
          {
            id: "pattern-calico-1",
            name: "Original",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#211E1F", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
          {
            id: "pattern-calico-2",
            name: "Little Spots",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#E5954B", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
          {
            id: "pattern-calico-3",
            name: "Mask",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#211E1F", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      tabby: {
        name: "Tabby",
        variations: [
          {
            id: "pattern-tabby-1",
            name: "Classic",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FAD6A5", s1: "#D67D33", s2: "#B55A12", ears: "#D67D33", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
          {
            id: "pattern-tabby-2",
            name: "Tiger",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#DCDCDC", s1: "#888888", s2: "#555555", ears: "#888888", eyeL: "#A5E6FA", eyeM: "#4BADE5", eyeD: "#1F6895", pupil: "#0D0D0D" },
          },
          {
            id: "pattern-tabby-3",
            name: "Mackerel",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#E2CDAE", s1: "#8A6343", s2: "#5A3F27", ears: "#8A6343", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
        ],
      },
      tuxedo: {
        name: "Tuxedo",
        variations: [
          {
            id: "pattern-tuxedo-1",
            name: "Tuxedo",
            activePickers: ["base", "spot1", "ears"],
            labels: { base: "base", spot1: "pattern_1", ears: "ears" },
            preset: { base: "#211E1F", s1: "#FFFFFF", s2: "#FFFFFF", ears: "#211E1F", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
        ],
      },
      solido: {
        name: "Solido",
        variations: [
          {
            id: "pattern-solid",
            name: "Solid Color",
            activePickers: ["base"],
            labels: { base: "base" },
            preset: { base: "#211E1F", s1: "#211E1F", s2: "#211E1F", ears: "#211E1F", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      siamese: {
        name: "Siam\u00e9s",
        variations: [
          {
            id: "pattern-siamese-1",
            name: "Siamese",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#F5E6D3", s1: "#D4B895", s2: "#5C4033", ears: "#5C4033", eyeL: "#A5E6FA", eyeM: "#4BADE5", eyeD: "#1F6895", pupil: "#0D0D0D" },
          },
        ],
      },
      custom: {
        name: "Custom",
        isCustom: true,
        variations: [
          {
            id: "pattern-calico-1",
            name: "Free",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#211E1F", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
        ],
      },
    },
  },
  perro: {
    ears: "dog-up",
    breeds: {
      shiba: {
        name: "Shiba",
        ears: "dog-up",
        variations: [
          {
            id: "pattern-dog-shiba",
            name: "Urajiro",
            activePickers: ["base", "spot1", "ears"],
            labels: { base: "base", spot1: "pattern_1", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#FFFFFF", ears: "#E5954B", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      husky: {
        name: "Husky",
        ears: "dog-up",
        variations: [
          {
            id: "pattern-dog-husky",
            name: "Mask",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#FFFFFF", s2: "#334155", ears: "#334155", eyeL: "#A5E6FA", eyeM: "#4BADE5", eyeD: "#1F6895", pupil: "#0D0D0D" },
          },
        ],
      },
      golden: {
        name: "Golden",
        ears: "dog-flop",
        variations: [
          {
            id: "pattern-solid",
            name: "Solid",
            activePickers: ["base", "ears"],
            labels: { base: "base", ears: "ears" },
            preset: { base: "#FCD34D", s1: "#FCD34D", s2: "#FCD34D", ears: "#FBBF24", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      border: {
        name: "Border Collie",
        ears: "dog-flop",
        variations: [
          {
            id: "pattern-dog-tuxedo",
            name: "Tuxedo",
            activePickers: ["base", "spot1", "ears"],
            labels: { base: "base", spot1: "pattern_1", ears: "ears" },
            preset: { base: "#211E1F", s1: "#FFFFFF", s2: "#FFFFFF", ears: "#211E1F", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      dalmata: {
        name: "Dalmatian",
        ears: "dog-flop",
        variations: [
          {
            id: "pattern-dog-dalmata",
            name: "Dotted",
            activePickers: ["base", "spot2", "ears"],
            labels: { base: "base", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#FFFFFF", s2: "#211E1F", ears: "#211E1F", eyeL: "#A5E6FA", eyeM: "#4BADE5", eyeD: "#1F6895", pupil: "#0D0D0D" },
          },
        ],
      },
      custom: {
        name: "Custom",
        isCustom: true,
        ears: "dog-up",
        variations: [
          {
            id: "pattern-dog-shiba",
            name: "Free",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#211E1F", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
        ],
      },
    },
  },
  erizo: {
    ears: "hedgehog",
    breeds: {
      estandar: {
        name: "Brown",
        variations: [
          {
            id: "pattern-solid",
            name: "Original",
            activePickers: ["base", "spot2", "spot1", "ears"],
            labels: { base: "base", spot2: "pattern_2", spot1: "pattern_1", ears: "ears" },
            preset: { base: "#EED9C4", s1: "#D4B895", s2: "#5C4033", ears: "#D4B895", eyeL: "#FDEB9E", eyeM: "#E5A626", eyeD: "#996311", pupil: "#0D0D0D" },
          },
        ],
      },
      custom: {
        name: "Custom",
        isCustom: true,
        variations: [
          {
            id: "pattern-solid",
            name: "Free",
            activePickers: ["base", "spot1", "spot2", "ears"],
            labels: { base: "base", spot1: "pattern_1", spot2: "pattern_2", ears: "ears" },
            preset: { base: "#FFFFFF", s1: "#E5954B", s2: "#211E1F", ears: "#211E1F", eyeL: "#E8F196", eyeM: "#95C23D", eyeD: "#4A7314", pupil: "#0D0D0D" },
          },
        ],
      },
    },
  },
};

/** All SVG pattern element IDs (for show/hide management). */
export const ALL_PATTERNS = [
  "pattern-calico-1", "pattern-calico-2", "pattern-calico-3",
  "pattern-tabby-1", "pattern-tabby-2", "pattern-tabby-3",
  "pattern-tuxedo-1", "pattern-siamese-1",
  "pattern-dog-shiba", "pattern-dog-husky", "pattern-dog-pug",
  "pattern-dog-dalmata", "pattern-dog-tuxedo", "pattern-solid",
];