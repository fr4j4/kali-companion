// HUD — corner widgets overlay on the Stage.
//
//   top-left    : clock / date + panel buttons (history, customizer, library, conversation)
//   top-right   : status·model pill (consolidated) + new chat + settings
//   bottom-right: jobs (mini progress)
//
// Everything is low-opacity at rest and brightens on hover.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Plus, History, Radio, Cpu, Palette, Library, MessageSquare, X, Zap, Mic, LayoutGrid, Menu, Volume2, Gamepad2 } from "lucide-react";
import { useStage } from "./StageProvider";
import { IconButton } from "../components/ui/IconButton";
import type { StatusEvent, TurnStatsEvent } from "../lib/protocol";

interface Props {
  onOpenSettings: () => void;
  onOpenJobs: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenArtifacts: () => void;
  onOpenConversation: () => void;
  onNewSession: () => void;
  onOpenWindowSwitcher?: () => void;
  onOpenMobileMenu?: () => void;
  isMobile?: boolean;
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
  onOpenWindowSwitcher,
  onOpenMobileMenu,
  isMobile = false,
  artifactsOpenCount,
  artifactsClosedCount,
}: Props) {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();
  const [now, setNow] = useState(() => new Date());
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

  const runningJobs = Array.from(chat.jobs.values()).filter((j) => j.status === "running").length;
  const hasProvider = chat.systemStatus?.llm_active ?? false;

  const statusDotClass = !hasProvider
    ? "bg-err"
    : chat.status === "ready" ? "bg-ok"
    : chat.status === "error" ? "bg-err"
    : "bg-muted";

  const statusKey = !hasProvider ? "status.disconnected" : `status.${chat.status}`;

  // STT dot
  const sttProvider = chat.systemStatus?.stt_provider ?? "vosk";
  const sttEnabled = chat.systemStatus?.stt_enabled ?? false;
  const sttLoaded = chat.systemStatus?.stt_loaded ?? (sttProvider === "vosk");
  const sttDotClass = (sttEnabled && sttLoaded) ? "bg-ok" : "bg-muted";

  // TTS dot
  const ttsLoaded = chat.systemStatus?.tts_loaded ?? false;
  const ttsAvailable = chat.systemStatus?.tts_available ?? true;
  const ttsError = chat.systemStatus?.tts_error;
  const ttsDotClass = ttsError ? "bg-err" : (ttsLoaded && ttsAvailable) ? "bg-ok" : "bg-muted";
  const ttsProvider = chat.systemStatus?.tts_provider ?? "piper";

  // Consolidated label
  const llmLabel = hasProvider
    ? (chat.systemStatus!.llm_model || chat.systemStatus!.llm_provider)
    : "—";

  const openArtifacts = artifactsOpenCount;
  const closedArtifacts = artifactsClosedCount;
  const totalArtifacts = openArtifacts + closedArtifacts;

  return (
    <>
      {isMobile ? (
        <div className="pointer-events-auto absolute top-[max(10px,env(safe-area-inset-top))] left-3 right-3 z-20">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2">
            <div className="hud-corner flex items-center gap-3 opacity-100">
              <div className="flex flex-col gap-0.5">
                <span className="text-foreground text-base font-prose leading-none tabular-nums">{timeStr}</span>
                <span className="text-muted text-[10px] leading-none capitalize">{dateStr}</span>
              </div>
            </div>
            <div />
            <MobileIconButton onClick={onOpenArtifacts} label={t("dock.artifacts_hint") as string}>
              <Library size={15} />
              {totalArtifacts > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {totalArtifacts}
                </span>
              )}
            </MobileIconButton>
            <MobileIconButton onClick={onOpenWindowSwitcher} label={t("stage.windows") as string}>
              <LayoutGrid size={15} />
            </MobileIconButton>
            <MobileIconButton onClick={onOpenMobileMenu} label={t("dock.overflow") as string}>
              <Menu size={15} />
            </MobileIconButton>
          </div>
        </div>
      ) : (
        <>
          {/* Top-left: clock + panel buttons + artifacts beacon */}
          <div className="pointer-events-auto absolute top-4 left-5 z-20 flex flex-col gap-2">
            <div className="hud-corner flex items-center gap-3" style={{ opacity: 1 }}>
              <div className="flex flex-col gap-0.5">
                <span className="text-foreground text-lg font-prose leading-none tabular-nums">{timeStr}</span>
                <span className="text-muted text-[11px] leading-none capitalize">{dateStr}</span>
              </div>
              <div className="w-px h-7 bg-border/40" />
              <div className="flex items-center gap-0.5">
                <IconButton size="sm" onClick={onOpenHistory} aria-label={t("stage.history")} title={t("stage.history")}>
                  <History size={15} />
                </IconButton>
                <IconButton size="sm" onClick={onOpenCustomizer} aria-label={t("dock.customizer")} title={t("dock.customizer")}>
                  <Palette size={15} />
                </IconButton>
                <IconButton size="sm" onClick={onOpenConversation} aria-label={t("dock.conversation")} title={t("dock.conversation")}>
                  <MessageSquare size={15} />
                </IconButton>
              </div>
            </div>

            <ArtifactsBeacon
              count={totalArtifacts}
              openCount={openArtifacts}
              closedCount={closedArtifacts}
              onClick={onOpenArtifacts}
            />
          </div>

          {/* Top-right: status·model pill + new chat + settings */}
          <div className="hud-corner absolute top-4 right-5 z-20 flex items-center gap-2" style={{ opacity: 1 }}>
            <IconButton size="sm" onClick={onNewSession} aria-label={t("stage.new_chat")} title={t("stage.new_chat")}>
              <Plus size={16} />
            </IconButton>
            {ptt.wakeWordActive && (
              <span className="hud-pill" title={t("wake_word.listening")}>
                <Radio size={11} className="text-accent" />
                {t("wake_word.listening")}
              </span>
            )}
            {chat.systemStatus && (
              <div className="relative">
                <button
                  onClick={() => setStatsOpen((v) => !v)}
                  className="hud-pill cursor-pointer"
                  title={`${t(statusKey)} · LLM: ${llmLabel}  STT: ${sttProvider}  TTS: ${ttsProvider}`}
                >
                  <span className="flex items-center gap-[2px]">
                    <span className={`w-[5px] h-[5px] rounded-full ${statusDotClass}`} />
                    <span className={`w-[5px] h-[5px] rounded-full ${sttDotClass}`} />
                    <span className={`w-[5px] h-[5px] rounded-full ${ttsDotClass}`} />
                  </span>
                  {llmLabel} · {sttProvider} · {ttsProvider}
                </button>
                {statsOpen && (
                  <ModelStatsPanel
                    systemStatus={chat.systemStatus}
                    turnStats={chat.turnStats}
                    messageCount={chat.messages.length}
                    artifactCount={chat.artifacts.size}
                    toolCallCount={chat.toolEvents.length}
                    onClose={() => setStatsOpen(false)}
                  />
                )}
              </div>
            )}
            <IconButton size="sm" onClick={onOpenSettings} aria-label={t("stage.settings")} title={t("stage.settings")}>
              <Settings size={16} />
            </IconButton>
          </div>

          {/* Bottom-right: jobs */}
          <div className="hud-corner absolute bottom-4 right-5 z-20">
            <IconButton size="sm" onClick={onOpenJobs} aria-label={t("stage.jobs")} title={t("stage.jobs")} active={runningJobs > 0}>
              <Cpu size={16} />
              {runningJobs > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {runningJobs}
                </span>
              )}
            </IconButton>
          </div>
        </>
      )}
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
  compact = false,
}: {
  count: number;
  openCount: number;
  closedCount: number;
  onClick: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const hasArtifacts = count > 0;
  return (
    <button
      onClick={onClick}
      aria-label={t("dock.artifacts_hint") as string}
      title={t("dock.artifacts_hint") as string}
      className={`artifacts-beacon group inline-flex items-center gap-2 rounded-full bg-accent text-white border border-accent cursor-pointer transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
        compact ? "px-2.5 py-2 min-w-11 justify-center" : "px-3 py-1.5"
      }`}
    >
      <Library size={14} className="shrink-0" />
      {!compact && <span className="badge text-white/90">{t("dock.artifacts")}</span>}
      {hasArtifacts && (
        <span className="flex items-center gap-1 tabular-nums text-[11px] font-mono leading-none">
          <span className="text-white">{openCount}</span>
          <span className="text-white/40">·</span>
          <span className="text-white/60">{closedCount}</span>
        </span>
      )}
    </button>
  );
}

function MobileIconButton({
  onClick,
  label,
  children,
}: {
  onClick?: () => void;
  label: string;
  children: ReactNode;
}) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative h-9 w-9 rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--bg-elev)_88%,transparent)] text-fg flex items-center justify-center shadow-lg backdrop-blur-md transition active:scale-95"
    >
      {children}
    </button>
  );
}

function ModelStatsPanel({
  systemStatus,
  turnStats,
  messageCount,
  artifactCount,
  toolCallCount,
  onClose,
}: {
  systemStatus: StatusEvent;
  turnStats: TurnStatsEvent | null;
  messageCount: number;
  artifactCount: number;
  toolCallCount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ts = turnStats;

  return (
    <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-bg/95 backdrop-blur-sm shadow-xl overflow-hidden z-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">Model Stats</span>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-border/50 transition-colors"
        >
          <X size={12} className="text-muted" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <StatsSection title={t("stats.model")} icon={<Cpu size={12} />}>
          <StatsRow label={t("stats.provider")} value={systemStatus.llm_provider || "—"} />
          <StatsRow label={t("stats.model")} value={systemStatus.llm_model || "—"} mono />
          {systemStatus.llm_active && (
            <>
              <StatsRow label={t("stats.api_url")} value={systemStatus.llm_api_url.replace(/^https?:\/\//, "")} mono />
              <StatsRow label={t("stats.max_tokens")} value={String(systemStatus.llm_max_tokens ?? "-")} />
            </>
          )}
        </StatsSection>

        <StatsSection title="STT" icon={<Mic size={12} />}>
          <StatsRow label={t("stats.provider")} value={systemStatus.stt_provider} />
          <StatsRow label={t("stats.model")} value={systemStatus.stt_model ?? "-"} mono />
          <StatsRow label={t("stats.device")} value={systemStatus.stt_device ?? "-"} mono />
          <StatsRow label="Streaming" value={systemStatus.stt_streaming ? "On" : "Off"} />
        </StatsSection>

        <StatsSection title="TTS" icon={<Volume2 size={12} />}>
          <StatsRow label={t("stats.provider")} value={systemStatus.tts_provider} />
          <StatsRow label={t("stats.voice")} value={systemStatus.voice} />
          <StatsRow label={t("stats.model")} value={systemStatus.tts_model ?? "-"} mono />
          <StatsRow label={t("stats.device")} value={systemStatus.tts_device ?? "-"} mono />
          <StatsRow label={t("stats.mode")} value={systemStatus.tts_mode} />
          <StatsRow label={t("stats.auto")} value={systemStatus.auto_tts ? "On" : "Off"} />
        </StatsSection>

        {systemStatus.game_ai_enabled && systemStatus.game_model && (
          <StatsSection title="Game" icon={<Gamepad2 size={12} />}>
            <StatsRow label={t("stats.model")} value={systemStatus.game_model} mono />
            <StatsRow label="Temperature" value={String(systemStatus.game_temperature ?? "-")} />
            <StatsRow label={t("stats.max_tokens")} value={String(systemStatus.game_max_tokens ?? "-")} />
          </StatsSection>
        )}

        <StatsSection title={t("stats.session")} icon={<MessageSquare size={12} />}>
          <StatsRow label={t("stats.messages")} value={String(messageCount)} />
          <StatsRow label={t("stats.artifacts")} value={String(artifactCount)} />
          <StatsRow label={t("stats.tool_calls")} value={String(toolCallCount)} />
        </StatsSection>

        <StatsSection title={t("stats.last_turn")} icon={<Zap size={12} />}>
          {ts ? (
            <>
              <StatsRow label={t("stats.duration")} value={`${ts.elapsed}s`} />
              <StatsRow
                label={t("stats.first_token")}
                value={ts.first_token_latency != null ? `${ts.first_token_latency}s` : "-"}
              />
              <StatsRow label={t("stats.chars")} value={String(ts.char_count)} />
              <StatsRow label={t("stats.tool_calls")} value={String(ts.tool_call_count)} />
              {ts.usage && (
                <>
                  <StatsRow label={t("stats.prompt_tokens")} value={String(ts.usage.prompt_tokens ?? "-")} />
                  <StatsRow label={t("stats.completion_tokens")} value={String(ts.usage.completion_tokens ?? "-")} />
                  {ts.usage.reasoning_tokens != null && (
                    <StatsRow label={t("stats.reasoning_tokens")} value={String(ts.usage.reasoning_tokens)} />
                  )}
                </>
              )}
            </>
          ) : (
            <p className="text-xs text-muted italic">{t("stats.no_data")}</p>
          )}
        </StatsSection>
      </div>
    </div>
  );
}

function StatsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted font-medium uppercase tracking-wider">
        {icon}
        <span>{title}</span>
      </div>
      <div className="pl-3 space-y-0.5">{children}</div>
    </div>
  );
}

function StatsRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className={`text-foreground font-medium truncate ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}
