// SettingsModal — unified configuration shell with rail + 4 sections.
//
// Sections: Proveedor IA / Voz / Comportamiento / Apariencia.
// Replaces the old SettingsModal + AIConfigModal split.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Volume2, Sliders, Palette, Mic, Info, Gamepad2 } from "lucide-react";
import type { StatusEvent, SettingsEvent } from "../lib/protocol";
import { Modal } from "./ui/Modal";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { ProviderSection } from "./settings/ProviderSection";
import { TTSEngineSection } from "./settings/TTSEngineSection";
import { STTSection } from "./settings/STTSection";
import { BehaviorSection } from "./settings/BehaviorSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { GenerationSection } from "./settings/GenerationSection";
import { AboutSection } from "./settings/AboutSection";
import { GamingSection } from "./settings/GamingSection";

interface Props {
  open: boolean;
  onClose: () => void;
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Partial<SettingsEvent>) => void;
  theme: string;
  onThemeChange: (t: string) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Record<string, number>) => void;
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
  downloadTtsModel: (modelId: string, provider?: "qwen3" | "piper") => void;
  downloadSttModel: (modelId: string, provider?: "vosk" | "qwen3-asr") => void;
  downloadProgress: Record<string, number>;
  downloadError: string | null;
}

type SectionId = "ai" | "voice" | "stt" | "behavior" | "gaming" | "appearance" | "about";

interface SectionDef {
  id: SectionId;
  icon: typeof Cpu;
  labelKey: string;
}

const SECTIONS: SectionDef[] = [
  { id: "ai", icon: Cpu, labelKey: "settings.section.ai" },
  { id: "voice", icon: Volume2, labelKey: "settings.section.voice" },
  { id: "stt", icon: Mic, labelKey: "settings.section.stt" },
  { id: "behavior", icon: Sliders, labelKey: "settings.section.behavior" },
  { id: "gaming", icon: Gamepad2, labelKey: "settings.section.gaming" },
  { id: "appearance", icon: Palette, labelKey: "settings.section.appearance" },
  { id: "about", icon: Info, labelKey: "settings.section.about" },
];

export function SettingsModal({
  open,
  onClose,
  systemStatus,
  onUpdate,
  theme,
  onThemeChange,
  canvasAutoExpand,
  onCanvasAutoExpandChange,
  uiScale,
  onUIScaleChange,
  currentLanguage,
  onLanguageChange,
  downloadTtsModel,
  downloadSttModel,
  downloadProgress,
  downloadError,
}: Props) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const [active, setActive] = useState<SectionId>("ai");

  if (!open) return null;

  // Teal AI accent applies to the unified AI engine section.
  const isAISection = (id: SectionId) => id === "ai";

  const rail = (
    <nav className="flex gap-1" role="tablist">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActive(s.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              isActive
                ? isAISection(s.id)
                  ? "bg-ai-signal/10 text-ai-signal border border-ai-signal/30"
                  : "bg-accent/15 text-accent border border-accent/30"
                  : "text-fg hover:bg-white/5 border border-transparent"
            }`}
          >
            <Icon size={14} />
            {t(s.labelKey)}
          </button>
        );
      })}
    </nav>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      bare
      title={t("settings.title")}
      panelClassName="h-[min(720px,90svh)] max-h-[90svh]"
    >
      <div className="flex flex-col h-full">
        {isMobile ? (
          <div className="flex flex-col h-full">
            <div className="px-4 pt-3 pb-2 border-b border-border overflow-x-auto scrollbar-thin shrink-0">
              {rail}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto stage-scroll p-4">
              {renderSection()}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <aside className="w-52 border-r border-border p-3 shrink-0 overflow-y-auto scrollbar-thin">
              <div className="flex flex-col gap-1">
                {SECTIONS.map((s) => {
                  const Icon = s.icon;
                  const isActive = active === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left whitespace-nowrap ${
                        isActive
                          ? isAISection(s.id)
                            ? "bg-ai-signal/10 text-ai-signal"
                            : "bg-accent/15 text-accent"
                          : "text-fg hover:bg-white/5"
                      }`}
                    >
                      <Icon size={16} />
                      {t(s.labelKey)}
                    </button>
                  );
                })}
              </div>
            </aside>
            <div className="flex-1 min-h-0 overflow-y-auto stage-scroll p-5">{renderSection()}</div>
          </div>
        )}
      </div>
    </Modal>
  );

  function renderSection() {
    if (active === "ai") {
      return (
        <div className="flex flex-col gap-5">
          <ProviderSection systemStatus={systemStatus} />
          <GenerationSection systemStatus={systemStatus} onUpdate={onUpdate} />
        </div>
      );
    }
    if (active === "voice") return <TTSEngineSection systemStatus={systemStatus} onUpdate={onUpdate} downloadTtsModel={downloadTtsModel} downloadProgress={downloadProgress} downloadError={downloadError} />;
    if (active === "stt") return <STTSection systemStatus={systemStatus} onUpdate={onUpdate} downloadSttModel={downloadSttModel} downloadProgress={downloadProgress} downloadError={downloadError} />;
    if (active === "behavior") return <BehaviorSection systemStatus={systemStatus} onUpdate={onUpdate} />;
    if (active === "gaming") return <GamingSection systemStatus={systemStatus} onUpdate={onUpdate} />;
    if (active === "about") return <AboutSection />;
    return (
      <AppearanceSection
        theme={theme}
        onThemeChange={onThemeChange}
        canvasAutoExpand={canvasAutoExpand}
        onCanvasAutoExpandChange={onCanvasAutoExpandChange}
        uiScale={uiScale}
        onUIScaleChange={onUIScaleChange}
        currentLanguage={currentLanguage}
        onLanguageChange={onLanguageChange}
      />
    );
  }
}