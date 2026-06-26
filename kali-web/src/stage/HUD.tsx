// HUD — corner widgets overlay on the Stage.
//
//   top-left    : clock / date + panel buttons (history, customizer, library, conversation)
//   top-right   : status·model pill (consolidated) + new chat + settings
//   bottom-right: jobs (mini progress)
//
// Everything is low-opacity at rest and brightens on hover.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Plus, History, Radio, Cpu, Palette, Library, MessageSquare } from "lucide-react";
import { useStage } from "./StageProvider";
import { IconButton } from "../components/ui/IconButton";
import { Tooltip } from "../components/ui/Tooltip";

interface Props {
  onOpenSettings: () => void;
  onOpenJobs: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenArtifacts: () => void;
  onOpenConversation: () => void;
  onNewSession: () => void;
}

export function HUD({
  onOpenSettings,
  onOpenJobs,
  onOpenHistory,
  onOpenCustomizer,
  onOpenArtifacts,
  onOpenConversation,
  onNewSession,
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

  const statusDotClass =
    chat.status === "ready" ? "bg-ok" : chat.status === "error" ? "bg-err" : "bg-muted";

  return (
    <>
      {/* Top-left: clock + panel buttons */}
      <div className="hud-corner pointer-events-auto absolute top-4 left-5 z-20 flex items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground text-lg font-prose leading-none tabular-nums">{timeStr}</span>
          <span className="text-muted text-[11px] leading-none capitalize">{dateStr}</span>
        </div>
        <div className="w-px h-7 bg-border/40" />
        <div className="flex items-center gap-0.5">
          <Tooltip label={t("stage.history")}>
            <IconButton size="sm" onClick={onOpenHistory} aria-label={t("stage.history")}>
              <History size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t("dock.customizer")}>
            <IconButton size="sm" onClick={onOpenCustomizer} aria-label={t("dock.customizer")}>
              <Palette size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t("dock.library")}>
            <IconButton size="sm" onClick={onOpenArtifacts} aria-label={t("dock.library")}>
              <Library size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t("dock.conversation")}>
            <IconButton size="sm" onClick={onOpenConversation} aria-label={t("dock.conversation")}>
              <MessageSquare size={15} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Top-right: status·model pill + new chat + settings */}
      <div className="hud-corner absolute top-4 right-5 z-20 flex items-center gap-2">
        <Tooltip label={t("stage.settings")}>
          <IconButton size="sm" onClick={onOpenSettings} aria-label={t("stage.settings")}>
            <Settings size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("stage.new_chat")}>
          <IconButton size="sm" onClick={onNewSession} aria-label={t("stage.new_chat")}>
            <Plus size={16} />
          </IconButton>
        </Tooltip>
        {ptt.wakeWordActive && (
          <span className="hud-pill" title={t("wake_word.listening")}>
            <Radio size={11} className="text-accent" />
            {t("wake_word.listening")}
          </span>
        )}
        {chat.systemStatus && (
          <span className="hud-pill" title={chat.systemStatus.llm_model}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
            {t(statusKey)} · {chat.systemStatus.llm_model}
          </span>
        )}
      </div>

      {/* Bottom-right: jobs */}
      <div className="hud-corner absolute bottom-4 right-5 z-20">
        <Tooltip label={t("stage.jobs")}>
          <IconButton size="sm" onClick={onOpenJobs} aria-label={t("stage.jobs")} active={runningJobs > 0}>
            <Cpu size={16} />
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