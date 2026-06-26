// SettingsModal — unified configuration shell with rail + 4 sections.
//
// Sections: Proveedor IA / Voz / Comportamiento / Apariencia.
// Replaces the old SettingsModal + AIConfigModal split.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Volume2, Sliders, Palette } from "lucide-react";
import type { StatusEvent, SettingsEvent } from "../lib/protocol";
import { Modal } from "./ui/Modal";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { ProviderSection } from "./settings/ProviderSection";
import { VoiceSection } from "./settings/VoiceSection";
import { BehaviorSection } from "./settings/BehaviorSection";
import { AppearanceSection } from "./settings/AppearanceSection";

interface Props {
  open: boolean;
  onClose: () => void;
  systemStatus: StatusEvent | null;
  voices: { id: string; name: string }[];
  onUpdate: (patch: Partial<SettingsEvent>) => void;
  theme: string;
  onThemeChange: (t: string) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Record<string, number>) => void;
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
}

type SectionId = "provider" | "voice" | "behavior" | "appearance";

interface SectionDef {
  id: SectionId;
  icon: typeof Cpu;
  labelKey: string;
}

const SECTIONS: SectionDef[] = [
  { id: "provider", icon: Cpu, labelKey: "settings.section.provider" },
  { id: "voice", icon: Volume2, labelKey: "settings.section.voice" },
  { id: "behavior", icon: Sliders, labelKey: "settings.section.behavior" },
  { id: "appearance", icon: Palette, labelKey: "settings.section.appearance" },
];

export function SettingsModal({
  open,
  onClose,
  systemStatus,
  voices,
  onUpdate,
  theme,
  onThemeChange,
  canvasAutoExpand,
  onCanvasAutoExpandChange,
  uiScale,
  onUIScaleChange,
  currentLanguage,
  onLanguageChange,
}: Props) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const [active, setActive] = useState<SectionId>("provider");

  if (!open) return null;

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
                ? s.id === "provider"
                  ? "bg-ai-signal/10 text-ai-signal border border-ai-signal/30"
                  : "bg-accent/15 text-accent border border-accent/30"
                  : "text-muted hover:text-fg hover:bg-white/5 border border-transparent"
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
    <Modal open={open} onClose={onClose} size="xl" bare title={t("settings.title")}>
      <div className="flex flex-col h-full">
        {isMobile ? (
          <>
            <div className="px-4 pt-3 pb-2 border-b border-border overflow-x-auto shrink-0">
              {rail}
            </div>
            <div className="flex-1 overflow-y-auto stage-scroll p-4">
              {renderSection()}
            </div>
          </>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <aside className="w-44 border-r border-border p-3 shrink-0">
              <div className="flex flex-col gap-1">
                {SECTIONS.map((s) => {
                  const Icon = s.icon;
                  const isActive = active === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                        isActive
                          ? s.id === "provider"
                            ? "bg-ai-signal/10 text-ai-signal"
                            : "bg-accent/15 text-accent"
                          : "text-muted hover:text-fg hover:bg-white/5"
                      }`}
                    >
                      <Icon size={14} />
                      {t(s.labelKey)}
                    </button>
                  );
                })}
              </div>
            </aside>
            <div className="flex-1 overflow-y-auto stage-scroll p-5">{renderSection()}</div>
          </div>
        )}
      </div>
    </Modal>
  );

  function renderSection() {
    if (active === "provider") return <ProviderSection systemStatus={systemStatus} onUpdate={onUpdate} />;
    if (active === "voice") return <VoiceSection systemStatus={systemStatus} voices={voices} onUpdate={onUpdate} />;
    if (active === "behavior") return <BehaviorSection systemStatus={systemStatus} onUpdate={onUpdate} />;
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