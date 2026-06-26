// HUD — corner widgets overlay on the Stage.
//
//   top-left    : clock / date
//   top-right   : connection status · model · language · settings · new chat
//   bottom-left : history (opens SessionDrawer)
//   bottom-right: jobs (mini progress)
//
// Everything is low-opacity at rest and brightens on hover.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Plus, Zap, History, Radio, Cpu } from "lucide-react";
import { useStage } from "./StageProvider";
import { IconButton } from "../components/ui/IconButton";
import { Tooltip } from "../components/ui/Tooltip";

interface Props {
  onOpenSettings: () => void;
  onOpenAIConfig: () => void;
  onOpenJobs: () => void;
  onOpenHistory: () => void;
  onNewSession: () => void;
  onLanguageChange: (lang: string) => void;
  currentLanguage: string;
}

export function HUD({
  onOpenSettings,
  onOpenAIConfig,
  onOpenJobs,
  onOpenHistory,
  onNewSession,
  onLanguageChange,
  currentLanguage,
}: Props) {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

  const runningJobs = Array.from(chat.jobs.values()).filter((j) => j.status === "running").length;
  const statusKey = `status.${chat.status}`;

  return (
    <>
      {/* Top-left: clock */}
      <div className="hud-corner pointer-events-none absolute top-4 left-5 z-20 flex-col gap-0.5">
        <span className="text-foreground text-lg font-prose leading-none tabular-nums">{timeStr}</span>
        <span className="text-muted text-[11px] leading-none capitalize">{dateStr}</span>
      </div>

      {/* Top-right: status · model · wake word · language · new · settings */}
      <div className="hud-corner absolute top-4 right-5 z-20 flex-row-reverse">
        <Tooltip label={t("stage.settings")}>
          <IconButton size="sm" onClick={onOpenSettings} aria-label={t("stage.settings")}>
            <Settings size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("stage.ai_config")}>
          <IconButton size="sm" onClick={onOpenAIConfig} aria-label={t("stage.ai_config")}>
            <Cpu size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("stage.new_chat")}>
          <IconButton size="sm" onClick={onNewSession} aria-label={t("stage.new_chat")}>
            <Plus size={16} />
          </IconButton>
        </Tooltip>
        <select
          className="bg-transparent border border-border rounded-full px-2 py-1 text-[11px] text-muted cursor-pointer outline-none hover:text-foreground max-lg:min-h-[32px]"
          value={currentLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          aria-label={t("settings.language")}
        >
          <option value="en">{t("language.en")}</option>
          <option value="es">{t("language.es")}</option>
        </select>
        {chat.systemStatus && (
          <span className="hud-pill" title={chat.systemStatus.llm_model}>
            {chat.systemStatus.llm_model}
          </span>
        )}
        {ptt.wakeWordActive && (
          <span className="hud-pill" title={t("wake_word.listening")}>
            <Radio size={11} className="text-accent" />
            {t("wake_word.listening")}
          </span>
        )}
        <span className={`hud-pill status-${chat.status}`} title={t(statusKey)}>
          <span className={`w-1.5 h-1.5 rounded-full ${chat.status === "ready" ? "bg-ok" : chat.status === "error" ? "bg-err" : "bg-muted"}`} />
          {t(statusKey)}
        </span>
      </div>

      {/* Bottom-left: history */}
      <div className="hud-corner absolute bottom-4 left-5 z-20">
        <Tooltip label={t("stage.history")}>
          <IconButton size="sm" onClick={onOpenHistory} aria-label={t("stage.history")}>
            <History size={16} />
          </IconButton>
        </Tooltip>
      </div>

      {/* Bottom-right: jobs */}
      <div className="hud-corner absolute bottom-4 right-5 z-20">
        <Tooltip label={t("stage.jobs")}>
          <IconButton size="sm" onClick={onOpenJobs} aria-label={t("stage.jobs")} active={runningJobs > 0}>
            <Zap size={16} />
            {runningJobs > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {runningJobs}
              </span>
            )}
          </IconButton>
        </Tooltip>
      </div>
    </>
  );
}