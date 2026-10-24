// HUD — floating glass pills over the stage.
//
//   top-left   : connection state · model (opens the model stats)
//   top-centre : map / overview switch
//   top-right  : conversation, history, avatar, jobs, new chat, settings
//
// Phones and tablets get the compact corner layout instead.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Plus, History, Radio, Cpu, Palette, Library, MessageSquare, X, Zap, Mic, LayoutGrid, Menu, Network, Volume2, Gamepad2 } from "lucide-react";
import { useStage } from "./StageProvider";
import type { StatusEvent, TurnStatsEvent } from "../lib/protocol";

interface Props {
  onOpenSettings: () => void;
  onOpenJobs: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenArtifacts: () => void;
  onOpenConversation: () => void;
  /** The conversation is shown as a docked panel (so the button toggles it). */
  conversationDocked?: boolean;
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
  conversationDocked,
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

  // Consolidated label: connection name → model → vendor → fallback
  const s = chat.systemStatus!;
  const llmLabel = hasProvider
    ? (s.llm_connection_name || s.llm_model || s.llm_vendor_detected || s.llm_provider)
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
                <span className="absolute -top-1 -right-1 bg-accent text-on-accent text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
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
          {/* Top-left: connection state + model */}
          <div className="absolute left-8 top-7 z-20">
            {chat.systemStatus ? (
              <div className="relative">
                <button
                  onClick={() => setStatsOpen((v) => !v)}
                  className="hud-glass hud-status"
                  title={`${t(statusKey)} · LLM: ${llmLabel}  STT: ${sttProvider}  TTS: ${ttsProvider}`}
                  aria-expanded={statsOpen}
                >
                  <span className="flex items-center gap-[3px]" aria-hidden="true">
                    <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
                    <span className={`h-[7px] w-[7px] rounded-full ${sttDotClass}`} />
                    <span className={`h-[7px] w-[7px] rounded-full ${ttsDotClass}`} />
                  </span>
                  <span className="text-[13px] text-fg">{chat.isTurnActive ? t("hud.working") : t(statusKey)}</span>
                  <span className="text-[13px] text-muted" aria-hidden="true">·</span>
                  <span className="max-w-[160px] truncate font-mono text-xs text-muted">{llmLabel}</span>
                </button>
                {ptt.wakeWordActive && (
                  <span className="hud-glass mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted" title={t("wake_word.listening") as string}>
                    <Radio size={12} className="text-accent" aria-hidden="true" />
                    {t("wake_word.listening")}
                  </span>
                )}
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
            ) : null}
          </div>

          {/* Top-centre: map / overview */}
          <div className="hud-glass absolute left-1/2 top-7 z-20 flex -translate-x-1/2 items-center gap-1 p-1" style={{ marginLeft: "calc(var(--chat-dock-w, 0px) / -2)" }} role="group" aria-label={t("hud.view") as string}>
            <span className="hud-seg is-active" aria-current="true"><Network size={15} aria-hidden="true" />{t("hud.map")}</span>
            <button className="hud-seg" onClick={onOpenArtifacts}>
              <LayoutGrid size={15} aria-hidden="true" />
              {t("hud.overview")}
              {totalArtifacts > 0 && <span className="hud-count">{totalArtifacts}</span>}
            </button>
          </div>

          {/* Top-right: actions */}
          <div className="hud-glass absolute top-7 z-20 flex items-center gap-0.5 p-1" style={{ right: "calc(var(--chat-dock-w, 0px) + 32px)" }}>
            <HudButton onClick={onOpenConversation} label={t("dock.conversation") as string} active={conversationDocked}><MessageSquare size={18} /></HudButton>
            <HudButton onClick={onOpenHistory} label={t("stage.history") as string}><History size={18} /></HudButton>
            <HudButton onClick={onOpenCustomizer} label={t("dock.customizer") as string}><Palette size={18} /></HudButton>
            <HudButton onClick={onOpenJobs} label={t("stage.jobs") as string} active={runningJobs > 0}>
              <Cpu size={18} />
              {runningJobs > 0 && <span className="hud-count absolute -right-0.5 -top-0.5">{runningJobs}</span>}
            </HudButton>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <HudButton onClick={onNewSession} label={t("stage.new_chat") as string}><Plus size={18} /></HudButton>
            <HudButton onClick={onOpenSettings} label={t("stage.settings") as string}><Settings size={18} /></HudButton>
          </div>
        </>
      )}
    </>
  );
}

function HudButton({ onClick, label, active, children }: { onClick: () => void; label: string; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active} className={`hud-btn ${active ? "is-active" : ""}`}>
      {children}
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
      className="relative h-9 w-9 rounded-xl border border-fg/10 bg-[color-mix(in_srgb,var(--bg-elev)_88%,transparent)] text-fg flex items-center justify-center shadow-lg backdrop-blur-md transition active:scale-95"
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
          <StatsRow label={t("stats.provider")} value={systemStatus.llm_connection_name || systemStatus.llm_vendor_detected || systemStatus.llm_provider || "—"} />
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

        {systemStatus.game_ai_enabled && (
          <StatsSection title="Game" icon={<Gamepad2 size={12} />}>
            <StatsRow label={t("stats.model")} value={
              systemStatus.game_connection_id === "active"
                ? (systemStatus.llm_model || "—")
                : (systemStatus.game_model || "—")
            } mono />
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
