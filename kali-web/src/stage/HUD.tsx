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
  /** Open artifact windows count (for the beacon readout). */
  artifactsOpenCount: number;
  /** Closed artifact windows count (for the beacon readout). */
  artifactsClosedCount: number;
}

export function HUD({
  onOpenSettings,
  onOpenJobs,
  onOpenHistory,
  onOpenCustomizer,
  onOpenArtifacts,
  onOpenConversation,
  onNewSession,
  artifactsOpenCount,
  artifactsClosedCount,
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

  // Artifact readout — the beacon shows open · closed at a glance.
  const openArtifacts = artifactsOpenCount;
  const closedArtifacts = artifactsClosedCount;
  const totalArtifacts = openArtifacts + closedArtifacts;

  return (
    <>
      {/* Top-left: clock + panel buttons + artifacts beacon */}
      <div className="pointer-events-auto absolute top-4 left-5 z-20 flex flex-col gap-2">
        <div className="hud-corner flex items-center gap-3">
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
            <Tooltip label={t("dock.conversation")}>
              <IconButton size="sm" onClick={onOpenConversation} aria-label={t("dock.conversation")}>
                <MessageSquare size={15} />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {/* Artifacts beacon — the one fixed beacon for everything Kali built
            in this session. Full opacity (exempt from the HUD's dim-at-rest
            convention): it is the thesis of the feature. Accent fill signals
            a real action; the readout shows open · closed at a glance. */}
        <ArtifactsBeacon
          count={totalArtifacts}
          openCount={openArtifacts}
          closedCount={closedArtifacts}
          onClick={onOpenArtifacts}
        />
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

/**
 * Artifacts beacon — a prominent pill button for the "Artefactos" library.
 * Lives on its own row below the dim HUD cluster, at full opacity with an
 * accent fill. The counter is a two-segment readout: open · closed, so you
 * see the session's state at a glance without a word.
 */
function ArtifactsBeacon({
  count,
  openCount,
  closedCount,
  onClick,
}: {
  count: number;
  openCount: number;
  closedCount: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const hasArtifacts = count > 0;
  return (
    <Tooltip label={t("dock.artifacts_hint")}>
      <button
        onClick={onClick}
        aria-label={t("dock.artifacts_hint") as string}
        className="artifacts-beacon group inline-flex items-center gap-2 rounded-full bg-accent text-white border border-accent px-3 py-1.5 cursor-pointer transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Library size={14} className="shrink-0" />
        <span className="badge text-white/90">{t("dock.artifacts")}</span>
        {hasArtifacts && (
          <span className="flex items-center gap-1 tabular-nums text-[11px] font-mono leading-none">
            <span className="text-white">{openCount}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/60">{closedCount}</span>
          </span>
        )}
      </button>
    </Tooltip>
  );
}