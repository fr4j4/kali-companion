import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  type AvatarConfig,
  type AvatarSpecies,
  type EarType,
  saveAvatarConfig,
  resetAvatarConfig,
} from "../avatar/avatarConfig";
import { animalDatabase, type Breed, type Variation, SPECIES_EARS, SPECIES_PATTERNS } from "../avatar/avatarPresets";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { Overlay } from "../components/ui/Overlay";
import { Cat, Palette, User, Sparkles } from "lucide-react";
import { SpeciesIcon } from "../components/ui/SpeciesIcon";
import { Select } from "../components/ui/Select";

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

type TabId = "base" | "style" | "face" | "addons";

export function CustomizerDrawer({ open, onClose, config, onChange }: Props) {
  const { t } = useTranslation();
  const [selectedBreed, setSelectedBreed] = useState<string>(config.breed);
  const [selectedVariation, setSelectedVariation] = useState<number>(0);
  const [species, setSpecies] = useState<AvatarSpecies>(config.species);
  const [activeTab, setActiveTab] = useState<TabId>("base");

  useEffect(() => {
    if (open) {
      setSpecies(config.species);
      setSelectedBreed(config.breed);
      
      const breed = animalDatabase[config.species].breeds[config.breed];
      if (breed) {
        const vIdx = breed.variations.findIndex(v => v.id === config.pattern);
        setSelectedVariation(vIdx >= 0 ? vIdx : 0);
      }
    }
  }, [open, config.species, config.breed, config.pattern]);

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
      breed: firstBreedKey,
      ears,
      pattern: variation.id,
      colors: { base: variation.preset.base, spot1: variation.preset.s1, spot2: variation.preset.s2, ears: variation.preset.ears },
      eyes: { light: variation.preset.eyeL, main: variation.preset.eyeM, dark: variation.preset.eyeD, pupil: variation.preset.pupil },
    });
  }, [config, onChange]);

  const selectBreed = useCallback((breedKey: string) => {
    setSelectedBreed(breedKey);
    setSelectedVariation(0);
    if (breedKey === "custom") {
      onChange({ ...config, breed: "custom" });
      return;
    }
    const breed = animalDatabase[species].breeds[breedKey];
    const ears = breed.ears || animalDatabase[species].ears;
    const variation = breed.variations[0];
    onChange({
      ...config,
      breed: breedKey,
      ears,
      pattern: variation.id,
      colors: { base: variation.preset.base, spot1: variation.preset.s1, spot2: variation.preset.s2, ears: variation.preset.ears },
      eyes: { light: variation.preset.eyeL, main: variation.preset.eyeM, dark: variation.preset.eyeD, pupil: variation.preset.pupil },
    });
  }, [species, config, onChange]);

  const setEars = useCallback((ears: EarType) => {
    onChange({ ...config, ears });
  }, [config, onChange]);

  const setPattern = useCallback((pattern: string) => {
    onChange({ ...config, pattern });
  }, [config, onChange]);

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
    setSpecies(reset.species);
    setSelectedBreed(reset.breed);
    setSelectedVariation(0);
  }, [onChange]);

  const currentBreed: Breed | undefined = animalDatabase[species]?.breeds[selectedBreed];
  const currentVariation: Variation | undefined = currentBreed?.variations[selectedVariation];
  const isCustom = currentBreed?.isCustom || false;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="sheet-right"
      size="lg"
      title={t("customizer.title")}
      bare
    >
      <div className="flex flex-col h-full bg-elevated">
        {/* Tabs Header */}
        <div className="flex border-b border-border bg-elevated sticky top-0 z-10">
          <button
            onClick={() => setActiveTab("base")}
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition ${activeTab === "base" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-fg"}`}
          >
            <Cat size={18} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t("customizer.tabs.base")}</span>
          </button>
          <button
            onClick={() => setActiveTab("style")}
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition ${activeTab === "style" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-fg"}`}
          >
            <Palette size={18} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t("customizer.tabs.style")}</span>
          </button>
          <button
            onClick={() => setActiveTab("face")}
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition ${activeTab === "face" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-fg"}`}
          >
            <User size={18} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t("customizer.tabs.face")}</span>
          </button>
          <button
            onClick={() => setActiveTab("addons")}
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition ${activeTab === "addons" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-fg"}`}
          >
            <Sparkles size={18} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{t("customizer.tabs.addons")}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 cust-body">
          {activeTab === "base" && (
            <>
              {/* 1. Species */}
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">{t("customizer.section.species")}</h3>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(Object.keys(animalDatabase) as AvatarSpecies[]).map((sp) => (
                    <button
                      key={sp}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition ${
                        species === sp 
                          ? "bg-accent/10 border-accent text-accent shadow-lg shadow-accent/5" 
                          : "bg-white/5 border-transparent text-muted hover:bg-white/10"
                      }`}
                      onClick={() => selectSpecies(sp)}
                    >
                      <SpeciesIcon species={sp} size={32} className="mb-2" />
                      <span className="text-xs font-bold capitalize">
                        {sp === "gato" ? t("customizer.species.cat") : sp === "perro" ? t("customizer.species.dog") : t("customizer.species.hedgehog")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Breed */}
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">{t("customizer.section.breed")}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(animalDatabase[species].breeds).map(([bKey]) => (
                    <button
                      key={bKey}
                      className={`px-4 py-3 rounded-xl border transition text-sm font-medium ${
                        selectedBreed === bKey 
                          ? "bg-accent border-accent text-white shadow-md shadow-accent/20" 
                          : "bg-white/5 border-white/10 text-muted hover:bg-white/10 hover:text-fg"
                      }`}
                      onClick={() => selectBreed(bKey)}
                    >
                      {t(`customizer.breed.${species}.${bKey}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Ears + Patterns (solo en modo Custom) */}
              {isCustom && (
                <>
                  <div className="customizer-section">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-1 h-4 bg-accent rounded-full" />
                      <h3 className="text-sm font-bold m-0">{t("customizer.section.ears")}</h3>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {SPECIES_EARS[species].map((et) => (
                        <button
                          key={et}
                          className={`py-3 rounded-xl border transition text-[10px] font-bold uppercase tracking-tight ${
                            config.ears === et 
                              ? "bg-accent border-accent text-white" 
                              : "bg-white/5 border-white/10 text-muted hover:bg-white/10 hover:text-fg"
                          }`}
                          onClick={() => setEars(et)}
                        >
                          {t(`customizer.ears.${et.replace("-", "_")}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="customizer-section">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-1 h-4 bg-accent rounded-full" />
                      <h3 className="text-sm font-bold m-0">{t("customizer.patterns")}</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-2 max-h-[160px] overflow-y-auto pr-2 stage-scroll">
                      {SPECIES_PATTERNS[species].map((pid) => (
                        <button
                          key={pid}
                          className={`px-2 py-2 rounded-lg border transition text-[9px] font-bold truncate ${
                            config.pattern === pid 
                              ? "bg-accent border-accent text-white" 
                              : "bg-white/5 border-white/10 text-muted hover:bg-white/10 hover:text-fg"
                          }`}
                          onClick={() => setPattern(pid)}
                          title={pid}
                        >
                          {pid.replace("pattern-", "").replace("-", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === "style" && (
            <>
              {/* Variations / Patterns — solo cuando NO es Custom (Custom lo tiene en Base) */}
              {!isCustom && (
                <div className="customizer-section">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-4 bg-accent rounded-full" />
                    <h3 className="text-sm font-bold m-0">{t("customizer.variants")}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {currentBreed?.variations.map((_vari, idx) => (
                      <button
                        key={idx}
                        className={`px-4 py-2.5 rounded-xl border transition text-xs font-bold ${
                          selectedVariation === idx 
                            ? "bg-accent border-accent text-white shadow-md shadow-accent/20" 
                            : "bg-white/5 border-white/10 text-muted hover:bg-white/10 hover:text-fg"
                        }`}
                        onClick={() => applyVariation(currentBreed, idx)}
                      >
                        {t(`customizer.variation.${species}.${selectedBreed}.${idx}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Colors */}
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">
                    {t("customizer.section.painter")}
                    {!isCustom && <span className="ml-2 text-[10px] font-normal text-muted uppercase tracking-widest">{t("customizer.auto")}</span>}
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-6 bg-white/5 p-5 rounded-2xl border border-white/5">
                  {(isCustom || currentVariation?.activePickers.includes("base")) && (
                    <ColorSwatchPicker label={t(currentVariation?.labels.base ? `customizer.label.${currentVariation.labels.base}` : "customizer.color.base")} value={config.colors.base} onChange={(v) => handleColorChange("base", v)} />
                  )}
                  {(isCustom || currentVariation?.activePickers.includes("spot1")) && (
                    <ColorSwatchPicker label={t(currentVariation?.labels.spot1 ? `customizer.label.${currentVariation.labels.spot1}` : "customizer.color.spot1")} value={config.colors.spot1} onChange={(v) => handleColorChange("spot1", v)} />
                  )}
                  {(isCustom || currentVariation?.activePickers.includes("spot2")) && (
                    <ColorSwatchPicker label={t(currentVariation?.labels.spot2 ? `customizer.label.${currentVariation.labels.spot2}` : "customizer.color.spot2")} value={config.colors.spot2} onChange={(v) => handleColorChange("spot2", v)} />
                  )}
                  {(isCustom || currentVariation?.activePickers.includes("ears")) && (
                    <ColorSwatchPicker label={t(currentVariation?.labels.ears ? `customizer.label.${currentVariation.labels.ears}` : "customizer.color.ears")} value={config.colors.ears} onChange={(v) => handleColorChange("ears", v)} />
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "face" && (
            <>
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">{t("customizer.section.eyes")}</h3>
                </div>
                
                <div className="bg-white/5 p-5 rounded-2xl border border-white/5 space-y-6">
                  <div>
                    <span className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3 block">{t("customizer.presets")}</span>
                    <div className="flex flex-wrap gap-3">
                      {EYE_PRESETS.map((preset, i) => (
                        <button
                          key={i}
                          className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-110 active:scale-95 ${
                            config.eyes.main === preset.main ? "border-accent ring-4 ring-accent/20" : "border-white/20"
                          }`}
                          style={{ background: `radial-gradient(circle at 30% 30%, ${preset.light}, ${preset.main} 60%, ${preset.dark})` }}
                          onClick={() => setEyeColor(preset.light, preset.main, preset.dark, preset.pupil)}
                          aria-label={t("customizer.eye_preset", { n: i + 1 })}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 pt-4 border-t border-white/10">
                    <ColorSwatchPicker label={t("customizer.eye.iris")} value={config.eyes.main} onChange={(v) => setEyeColor(config.eyes.light, v, config.eyes.dark, config.eyes.pupil)} />
                    <ColorSwatchPicker label={t("customizer.eye.border")} value={config.eyes.dark} onChange={(v) => setEyeColor(config.eyes.light, config.eyes.main, v, config.eyes.pupil)} />
                    <ColorSwatchPicker label={t("customizer.eye.pupil")} value={config.eyes.pupil} onChange={(v) => setEyeColor(config.eyes.light, config.eyes.main, config.eyes.dark, v)} />
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === "addons" && (
            <>
              {/* Neck */}
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">{t("customizer.section.neck")}</h3>
                </div>
                
                <div className="bg-white/5 p-5 rounded-2xl border border-white/5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted uppercase tracking-widest">{t("customizer.neck.accessory")}</label>
                    <Select
                      value={config.accessory}
                      onChange={(v) => setAccessory(v as AvatarConfig["accessory"])}
                      options={[
                        { value: "cascabel", label: t("customizer.neck.bell") },
                        { value: "placa", label: t("customizer.neck.plate") },
                        { value: "corazon", label: t("customizer.neck.heart") },
                        { value: "corbatin", label: t("customizer.neck.tie") },
                        { value: "flor", label: t("customizer.neck.flower") },
                        { value: "estrella", label: t("customizer.neck.star") },
                        { value: "bufanda", label: t("customizer.neck.scarf") },
                        { value: "ninguno", label: t("customizer.neck.none") },
                      ]}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <label className="text-[10px] font-bold text-muted uppercase tracking-widest">{t("customizer.neck.color")}</label>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-2">
                        {COLLAR_PRESETS.map((c) => (
                          <button 
                            key={c} 
                            className={`w-8 h-8 rounded-full border-2 transition ${config.collar === c ? "border-accent scale-110" : "border-white/10"}`} 
                            style={{ background: c }} 
                            onClick={() => setCollarColor(c)} 
                          />
                        ))}
                      </div>
                      <div className="w-px h-6 bg-white/10" />
                      <ColorSwatchPicker label={t("customizer.custom_color")} value={config.collar} onChange={setCollarColor} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Hats + Glasses */}
              <div className="customizer-section">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  <h3 className="text-sm font-bold m-0">{t("customizer.section.hats")}</h3>
                </div>

                <div className="bg-white/5 p-5 rounded-2xl border border-white/5 space-y-6">
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-muted uppercase tracking-widest">{t("customizer.hats.glasses")}</label>
                      <div className="flex gap-2">
                        <Select
                          value={config.glasses}
                          onChange={(v) => setGlasses(v as AvatarConfig["glasses"])}
                          options={[
                            { value: "none", label: t("customizer.hats.no_glasses") },
                            { value: "round", label: t("customizer.hats.round") },
                            { value: "square", label: t("customizer.hats.square") },
                          ]}
                          className="flex-1"
                        />
                        <ColorSwatchPicker label={t("customizer.glasses_color")} value={config.glassesColor} onChange={(v) => onChange({ ...config, glassesColor: v })} />
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-white/10">
                      <label className="text-[10px] font-bold text-muted uppercase tracking-widest">{t("customizer.hats.hat")}</label>
                      <div className="flex gap-2">
                        <Select
                          value={config.hat}
                          onChange={(v) => setHat(v as AvatarConfig["hat"])}
                          options={[
                            { value: "none", label: t("customizer.hats.no_hat") },
                            { value: "gorro", label: t("customizer.hats.beanie") },
                            { value: "copa", label: t("customizer.hats.top_hat") },
                            { value: "fiesta", label: t("customizer.hats.party") },
                          ]}
                          className="flex-1"
                        />
                        <ColorSwatchPicker label={t("customizer.hat_color")} value={config.hatColor} onChange={(v) => onChange({ ...config, hatColor: v })} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="p-5 border-t border-border bg-elevated/80 backdrop-blur-md flex gap-3">
          <button 
            onClick={handleReset} 
            className="px-6 py-4 rounded-2xl bg-white/5 text-muted text-sm font-bold hover:bg-white/10 hover:text-fg transition-all active:scale-95"
          >
            {t("customizer.reset")}
          </button>
          <button 
            onClick={handleSave} 
            className="flex-1 py-4 rounded-2xl bg-accent text-white text-sm font-black hover:brightness-110 transition-all active:scale-95 shadow-lg shadow-accent/20 btn-glow"
          >
            {t("customizer.save")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
