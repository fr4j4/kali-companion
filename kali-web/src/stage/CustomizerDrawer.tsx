/**
 * stage/CustomizerDrawer.tsx — Avatar customization drawer.
 *
 * Right-side drawer with 6 sections: Species, Breed/Pattern, Colors,
 * Eyes, Neck accessories, Hats/Glasses. Changes apply live to the avatar
 * via the config prop. Save persists to localStorage.
 *
 * Transcribed from the POC v7/customizer.js to React + TypeScript.
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import {
  type AvatarConfig,
  type AvatarSpecies,
  saveAvatarConfig,
  resetAvatarConfig,
} from "../avatar/avatarConfig";
import { animalDatabase, type Breed, type Variation } from "../avatar/avatarPresets";

interface Props {
  open: boolean;
  onClose: () => void;
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}

const EYE_PRESETS = [
  { light: "#E8F196", main: "#95C23D", dark: "#4A7314", pupil: "#0D0D0D" },
  { light: "#A5E6FA", main: "#4BADE5", dark: "#1F6895", pupil: "#0D0D0D" },
  { light: "#FDEB9E", main: "#E5A626", dark: "#996311", pupil: "#0D0D0D" },
  { light: "#FAD0C4", main: "#F08080", dark: "#953434", pupil: "#0D0D0D" },
  { light: "#DCD0FF", main: "#9B5DE5", dark: "#4A1D8A", pupil: "#0D0D0D" },
];

const COLLAR_PRESETS = ["#D33C37", "#3B82F6", "#10B981"];

export function CustomizerDrawer({ open, onClose, config, onChange }: Props) {
  const { t } = useTranslation();
  const [selectedBreed, setSelectedBreed] = useState<string>("");
  const [selectedVariation, setSelectedVariation] = useState<number>(0);
  const [species, setSpecies] = useState<AvatarSpecies>(config.species);

  // Initialize breed from config when opening.
  useEffect(() => {
    if (open) {
      setSpecies(config.species);
      // Find the breed that matches the current pattern.
      let foundBreed = "custom";
      for (const [bKey, breed] of Object.entries(animalDatabase[config.species].breeds)) {
        if (breed.variations.some((v) => v.id === config.pattern)) {
          foundBreed = bKey;
          break;
        }
      }
      setSelectedBreed(foundBreed);
    }
  }, [open, config]);

  const selectSpecies = useCallback((key: AvatarSpecies) => {
    setSpecies(key);
    const breeds = animalDatabase[key].breeds;
    const firstBreedKey = Object.keys(breeds)[0];
    setSelectedBreed(firstBreedKey);
    setSelectedVariation(0);
    const breed = breeds[firstBreedKey];
    const ears = breed.ears || animalDatabase[key].ears;
    const variation = breed.variations[0];
    onChange({
      ...config,
      species: key,
      ears,
      pattern: variation.id,
      colors: { base: variation.preset.base, spot1: variation.preset.s1, spot2: variation.preset.s2, ears: variation.preset.ears },
      eyes: { light: variation.preset.eyeL, main: variation.preset.eyeM, dark: variation.preset.eyeD, pupil: variation.preset.pupil },
    });
  }, [config, onChange]);

  const selectBreed = useCallback((breedKey: string) => {
    setSelectedBreed(breedKey);
    setSelectedVariation(0);
    const breed = animalDatabase[species].breeds[breedKey];
    const ears = breed.ears || animalDatabase[species].ears;
    const variation = breed.variations[0];
    onChange({
      ...config,
      ears,
      pattern: variation.id,
      colors: { base: variation.preset.base, spot1: variation.preset.s1, spot2: variation.preset.s2, ears: variation.preset.ears },
      eyes: { light: variation.preset.eyeL, main: variation.preset.eyeM, dark: variation.preset.eyeD, pupil: variation.preset.pupil },
    });
  }, [species, config, onChange]);

  const applyVariation = useCallback((breed: Breed, idx: number) => {
    setSelectedVariation(idx);
    const variation = breed.variations[idx];
    onChange({
      ...config,
      pattern: variation.id,
      colors: { base: variation.preset.base, spot1: variation.preset.s1, spot2: variation.preset.s2, ears: variation.preset.ears },
      eyes: { light: variation.preset.eyeL, main: variation.preset.eyeM, dark: variation.preset.eyeD, pupil: variation.preset.pupil },
    });
  }, [config, onChange]);

  const handleColorChange = useCallback((type: "base" | "spot1" | "spot2" | "ears", value: string) => {
    onChange({ ...config, colors: { ...config.colors, [type]: value } });
  }, [config, onChange]);

  const setEyeColor = useCallback((light: string, main: string, dark: string, pupil: string) => {
    onChange({ ...config, eyes: { light, main, dark, pupil } });
  }, [config, onChange]);

  const setAccessory = useCallback((accessory: AvatarConfig["accessory"]) => {
    onChange({ ...config, accessory });
  }, [config, onChange]);

  const setGlasses = useCallback((glasses: AvatarConfig["glasses"]) => {
    onChange({ ...config, glasses });
  }, [config, onChange]);

  const setHat = useCallback((hat: AvatarConfig["hat"]) => {
    onChange({ ...config, hat });
  }, [config, onChange]);

  const setCollarColor = useCallback((value: string) => {
    onChange({ ...config, collar: value });
  }, [config, onChange]);

  const handleSave = useCallback(() => {
    saveAvatarConfig(config);
    onClose();
  }, [config, onClose]);

  const handleReset = useCallback(() => {
    const reset = resetAvatarConfig();
    onChange(reset);
    setSpecies("gato");
    setSelectedBreed("calico");
    setSelectedVariation(0);
  }, [onChange]);

  const currentBreed: Breed | undefined = animalDatabase[species]?.breeds[selectedBreed];
  const currentVariation: Variation | undefined = currentBreed?.variations[selectedVariation];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.aside
            className="fixed inset-y-0 right-0 w-[360px] max-w-[90vw] bg-elevated border-l border-border z-50 flex flex-col"
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={t("customizer.aria_label")}
          >
            {/* Header */}
            <div className="cust-header">
              <div>
                <div className="badge text-muted mb-0.5">{t("customizer.badge")}</div>
                <div className="text-sm font-semibold text-fg">{t("customizer.title")}</div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center"
                aria-label={t("customizer.close")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Body */}
            <div className="cust-body">
              {/* 1. Species */}
              <div className="customizer-section">
                <h3>{t("customizer.section.species")}</h3>
                <div className="cust-btn-grid cols-3">
                  {(Object.keys(animalDatabase) as AvatarSpecies[]).map((sp) => (
                    <button
                      key={sp}
                      className={`cust-btn ${species === sp ? "active" : ""}`}
                      onClick={() => selectSpecies(sp)}
                    >
                      <span className="emoji">{sp === "gato" ? "\u{1F431}" : sp === "perro" ? "\u{1F436}" : "\u{1F994}"}</span>
                      {sp === "gato" ? t("customizer.species.cat") : sp === "perro" ? t("customizer.species.dog") : t("customizer.species.hedgehog")}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Breed + Variation */}
              <div className="customizer-section">
                <h3>{t("customizer.section.breed")}</h3>
                <div className="cust-btn-grid cols-3">
                  {Object.entries(animalDatabase[species].breeds).map(([bKey, breed]) => (
                    <button
                      key={bKey}
                      className={`cust-btn ${selectedBreed === bKey ? "active" : ""}`}
                      onClick={() => selectBreed(bKey)}
                    >
                      {breed.name}
                    </button>
                  ))}
                </div>
                {currentBreed && !currentBreed.isCustom && (
                  <>
                    <hr className="cust-section-divider" />
                    <div className="badge text-muted" style={{ marginBottom: 6 }}>{t("customizer.variants")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {currentBreed.variations.map((vari, idx) => (
                        <button
                          key={idx}
                          className={`cust-btn ${selectedVariation === idx ? "active" : ""}`}
                          onClick={() => applyVariation(currentBreed, idx)}
                        >
                          {vari.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* 3. Colors */}
              <div className="customizer-section">
                <h3>{t("customizer.section.painter")} <span style={{ fontSize: "7px", color: "var(--muted)", marginLeft: 3 }}>{t("customizer.auto")}</span></h3>
                <div className="cust-color-pickers">
                  {currentVariation?.activePickers.includes("base") && (
                    <ColorPicker label={currentVariation.labels.base || t("customizer.color.base")} value={config.colors.base} onChange={(v) => handleColorChange("base", v)} />
                  )}
                  {currentVariation?.activePickers.includes("spot1") && (
                    <ColorPicker label={currentVariation.labels.spot1 || t("customizer.color.spot1")} value={config.colors.spot1} onChange={(v) => handleColorChange("spot1", v)} />
                  )}
                  {currentVariation?.activePickers.includes("spot2") && (
                    <ColorPicker label={currentVariation.labels.spot2 || t("customizer.color.spot2")} value={config.colors.spot2} onChange={(v) => handleColorChange("spot2", v)} />
                  )}
                  {currentVariation?.activePickers.includes("ears") && (
                    <ColorPicker label={currentVariation.labels.ears || t("customizer.color.ears")} value={config.colors.ears} onChange={(v) => handleColorChange("ears", v)} />
                  )}
                </div>
              </div>

              {/* 4. Eyes */}
              <div className="customizer-section">
                <h3>{t("customizer.section.eyes")}</h3>
                <div className="cust-eye-presets">
                  {EYE_PRESETS.map((preset, i) => (
                    <button
                      key={i}
                      className="cust-preset-color"
                      style={{ background: `radial-gradient(circle, ${preset.light}, ${preset.main})` }}
                      onClick={() => setEyeColor(preset.light, preset.main, preset.dark, preset.pupil)}
                      aria-label={t("customizer.eye_preset", { n: i + 1 })}
                    />
                  ))}
                </div>
                <div className="cust-eye-custom">
                  <ColorPicker label={t("customizer.eye.iris")} value={config.eyes.main} onChange={(v) => setEyeColor(config.eyes.light, v, config.eyes.dark, config.eyes.pupil)} />
                  <ColorPicker label={t("customizer.eye.border")} value={config.eyes.dark} onChange={(v) => setEyeColor(config.eyes.light, config.eyes.main, v, config.eyes.pupil)} />
                  <ColorPicker label={t("customizer.eye.pupil")} value={config.eyes.pupil} onChange={(v) => setEyeColor(config.eyes.light, config.eyes.main, config.eyes.dark, v)} />
                </div>
              </div>

              {/* 5. Neck */}
              <div className="customizer-section">
                <h3>{t("customizer.section.neck")}</h3>
                <div className="cust-row">
                  <span className="cust-row-label">{t("customizer.neck.accessory")}</span>
                  <select
                    value={config.accessory}
                    onChange={(e) => setAccessory(e.target.value as AvatarConfig["accessory"])}
                    className="cust-select"
                  >
                    <option value="cascabel">{t("customizer.neck.bell")}</option>
                    <option value="placa">{t("customizer.neck.plate")}</option>
                    <option value="corazon">{t("customizer.neck.heart")}</option>
                    <option value="corbatin">{t("customizer.neck.tie")}</option>
                    <option value="flor">{t("customizer.neck.flower")}</option>
                    <option value="estrella">{t("customizer.neck.star")}</option>
                    <option value="bufanda">{t("customizer.neck.scarf")}</option>
                    <option value="ninguno">{t("customizer.neck.none")}</option>
                  </select>
                </div>
                <div className="cust-row">
                  <span className="cust-row-label">{t("customizer.neck.color")}</span>
                  <div className="cust-row-controls">
                    {COLLAR_PRESETS.map((c) => (
                      <button key={c} className="cust-preset-color" style={{ background: c }} onClick={() => setCollarColor(c)} aria-label={t("customizer.color_preset", { color: c })} />
                    ))}
                    <input
                      type="color"
                      value={config.collar}
                      onChange={(e) => setCollarColor(e.target.value)}
                      className="cust-preset-color"
                      style={{ padding: 0, WebkitAppearance: "none", appearance: "none", border: "none" }}
                      aria-label={t("customizer.custom_color")}
                    />
                  </div>
                </div>
              </div>

              {/* 6. Hats + Glasses */}
              <div className="customizer-section">
                <h3>{t("customizer.section.hats")}</h3>
                <div className="cust-row">
                  <span className="cust-row-label">{t("customizer.hats.glasses")}</span>
                  <div className="cust-row-controls">
                    <select
                      value={config.glasses}
                      onChange={(e) => setGlasses(e.target.value as AvatarConfig["glasses"])}
                      className="cust-select"
                    >
                      <option value="none">{t("customizer.hats.no_glasses")}</option>
                      <option value="round">{t("customizer.hats.round")}</option>
                      <option value="square">{t("customizer.hats.square")}</option>
                    </select>
                    <input
                      type="color"
                      value={config.glassesColor}
                      onChange={(e) => onChange({ ...config, glassesColor: e.target.value })}
                      className="cust-preset-color"
                      style={{ padding: 0, WebkitAppearance: "none", appearance: "none", border: "none" }}
                      aria-label={t("customizer.glasses_color")}
                    />
                  </div>
                </div>
                <hr className="cust-section-divider" />
                <div className="cust-row">
                  <span className="cust-row-label">{t("customizer.hats.hat")}</span>
                  <div className="cust-row-controls">
                    <select
                      value={config.hat}
                      onChange={(e) => setHat(e.target.value as AvatarConfig["hat"])}
                      className="cust-select"
                    >
                      <option value="none">{t("customizer.hats.no_hat")}</option>
                      <option value="gorro">{t("customizer.hats.beanie")}</option>
                      <option value="copa">{t("customizer.hats.top_hat")}</option>
                      <option value="fiesta">{t("customizer.hats.party")}</option>
                    </select>
                    <input
                      type="color"
                      value={config.hatColor}
                      onChange={(e) => onChange({ ...config, hatColor: e.target.value })}
                      className="cust-preset-color"
                      style={{ padding: 0, WebkitAppearance: "none", appearance: "none", border: "none" }}
                      aria-label={t("customizer.hat_color")}
                    />
                  </div>
                </div>
              </div>

              {/* Save / Reset */}
              <div className="flex gap-2" style={{ marginTop: 18, marginBottom: 4 }}>
                <button onClick={handleSave} className="flex-1 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:brightness-110 transition btn-glow">
                  {t("customizer.save")}
                </button>
                <button onClick={handleReset} className="flex-1 py-2 rounded-xl bg-white/5 text-fg text-xs font-bold hover:bg-white/10 transition border border-white/10">
                  {t("customizer.reset")}
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cust-picker-wrap">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="cust-picker-label">{label}</span>
    </div>
  );
}