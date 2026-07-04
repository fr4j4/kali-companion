import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gamepad2, Server, Cloud, Check, RotateCcw } from "lucide-react";
import type { StatusEvent } from "../../lib/protocol";
import { useStage } from "../../stage/StageProvider";
import { GameConnectionPicker } from "./connections/GameConnectionPicker";
import { SliderField, TextField, ToggleField } from "./fields";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const GAME_AI_DEFAULTS = {
  game_ai_global_timeout_ms: 20_000,
  game_temperature: 0.4,
  game_max_tokens: 256,
  game_retry_timeout_1_ms: 12_000,
  game_retry_timeout_2_ms: 3_000,
  game_retry_timeout_3_ms: 2_000,
  game_max_retries: 2,
  game_session_path: "",
  game_connection_id: "active",
  game_model: "",
  game_log_default_open: false,
  game_reasoning_default_open: false,
};

export function GamingSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { connections, chat } = useStage();
  const [advanced, setAdvanced] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const gameSessionPath = systemStatus?.game_session_path ?? GAME_AI_DEFAULTS.game_session_path;
  const gameAiGlobalTimeoutMs = systemStatus?.game_ai_global_timeout_ms ?? GAME_AI_DEFAULTS.game_ai_global_timeout_ms;
  const gameConnectionId = systemStatus?.game_connection_id ?? GAME_AI_DEFAULTS.game_connection_id;
  const gameModel = systemStatus?.game_model ?? GAME_AI_DEFAULTS.game_model;
  const gameTemperature = systemStatus?.game_temperature ?? GAME_AI_DEFAULTS.game_temperature;
  const gameMaxTokens = systemStatus?.game_max_tokens ?? GAME_AI_DEFAULTS.game_max_tokens;
  const timeout1 = systemStatus?.game_retry_timeout_1_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_1_ms;
  const timeout2 = systemStatus?.game_retry_timeout_2_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_2_ms;
  const timeout3 = systemStatus?.game_retry_timeout_3_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_3_ms;
  const gameMaxRetries = systemStatus?.game_max_retries ?? GAME_AI_DEFAULTS.game_max_retries;
  const gameLogDefaultOpen = systemStatus?.game_log_default_open ?? GAME_AI_DEFAULTS.game_log_default_open;
  const gameReasoningDefaultOpen = systemStatus?.game_reasoning_default_open ?? GAME_AI_DEFAULTS.game_reasoning_default_open;

  const activeConnectionId = chat.systemStatus?.llm_connection_id ?? null;
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeConnectionModel = activeConnection?.active_model ?? null;

  const isUsingActive = gameConnectionId === "active";
  const selectedConn = connections.find((c) => c.id === gameConnectionId);

  const displayName = isUsingActive
    ? t("settings.game_ai_using_active")
    : (selectedConn?.name ?? t("settings.game_ai_unknown_connection"));

  const displayUrl = isUsingActive
    ? (activeConnection ? `${activeConnection.name}${activeConnectionModel ? ` → ${activeConnectionModel}` : ""}` : "")
    : (selectedConn?.api_url ?? "");

  const displayModel = isUsingActive
    ? (activeConnectionModel ?? "")
    : gameModel;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Gamepad2}
        title={t("settings.section.gaming")}
        description={t("settings.gaming.description")}
      />

      <SettingsCard title={t("settings.gaming.panels_group")}>
        <ToggleField
          label={t("settings.game_log_default_open")}
          checked={gameLogDefaultOpen}
          onChange={(v) => onUpdate({ game_log_default_open: v })}
          helperText={t("settings.game_log_default_open_hint")}
        />
        <ToggleField
          label={t("settings.game_reasoning_default_open")}
          checked={gameReasoningDefaultOpen}
          onChange={(v) => onUpdate({ game_reasoning_default_open: v })}
          helperText={t("settings.game_reasoning_default_open_hint")}
        />
      </SettingsCard>

      <SettingsCard title={t("settings.gaming.storage_group")}>
        <TextField
          label={t("settings.game_session_path")}
          value={gameSessionPath}
          onChange={(v) => onUpdate({ game_session_path: v })}
          placeholder="~/.kali/game-sessions"
          helperText={t("settings.game_session_path_hint")}
        />
      </SettingsCard>

      <SettingsCard title={t("settings.gaming.timing_group")}>
        <SliderField
          label={t("settings.game_ai_global_timeout_ms")}
          value={gameAiGlobalTimeoutMs / 1000}
          min={5}
          max={120}
          step={5}
          onChange={(v) => onUpdate({ game_ai_global_timeout_ms: Math.round(v * 1000) })}
          displayValue={`${(gameAiGlobalTimeoutMs / 1000).toFixed(0)}${t("common.seconds_abbrev")}`}
          helperText={t("settings.game_ai_global_timeout_ms_hint")}
        />
      </SettingsCard>

      <SettingsCard title={t("settings.game_ai_title")}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.game_ai_title")}</label>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-elevated border border-border hover:border-accent/30 transition-colors text-left w-full"
          >
            {isUsingActive ? (
              <Check size={14} className="text-ok shrink-0" />
            ) : selectedConn?.kind === "cloud" ? (
              <Cloud size={14} className="text-muted shrink-0" />
            ) : (
              <Server size={14} className="text-muted shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground">{displayName}</div>
              <div className="text-[10px] text-muted font-mono mt-0.5 truncate">
                {displayUrl || t("settings.game_ai_no_connection")}
              </div>
              {displayModel && (
                <div className="text-[10px] text-accent font-mono mt-0.5 truncate">
                  {t("settings.game_ai_model_label")}: {displayModel}
                </div>
              )}
            </div>
            <span className="text-[11px] text-accent shrink-0 font-medium">
              {t("settings.game_ai_change")}
            </span>
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={t("settings.advanced_configuration")}>
        <ToggleField
          label={t("settings.advanced_configuration")}
          checked={advanced}
          onChange={setAdvanced}
        />

        {advanced && (
          <div className="flex flex-col gap-4 pl-3 border-l-2 border-border">
            <SliderField
              label={t("settings.game_temperature")}
              value={gameTemperature}
              min={0}
              max={2.0}
              step={0.1}
              onChange={(v) => onUpdate({ game_temperature: v })}
              displayValue={gameTemperature.toFixed(1)}
              helperText={t("settings.game_temperature_hint")}
            />

            <SliderField
              label={t("settings.game_max_tokens")}
              value={gameMaxTokens}
              min={128}
              max={2048}
              step={32}
              onChange={(v) => onUpdate({ game_max_tokens: Math.round(v) })}
              displayValue={String(gameMaxTokens)}
              helperText={t("settings.game_max_tokens_hint")}
            />

            <SliderField
              label={t("settings.game_retry_timeout_1_ms")}
              value={timeout1}
              min={2000}
              max={60_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_1_ms: Math.round(v) })}
              displayValue={`${timeout1}ms`}
              helperText={t("settings.game_retry_timeout_1_ms_hint")}
            />

            <SliderField
              label={t("settings.game_retry_timeout_2_ms")}
              value={timeout2}
              min={2000}
              max={30_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_2_ms: Math.round(v) })}
              displayValue={`${timeout2}ms`}
              helperText={t("settings.game_retry_timeout_2_ms_hint")}
            />

            <SliderField
              label={t("settings.game_retry_timeout_3_ms")}
              value={timeout3}
              min={2000}
              max={20_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_3_ms: Math.round(v) })}
              displayValue={`${timeout3}ms`}
              helperText={t("settings.game_retry_timeout_3_ms_hint")}
            />

            <SliderField
              label={t("settings.game_max_retries")}
              value={gameMaxRetries}
              min={1}
              max={5}
              step={1}
              onChange={(v) => onUpdate({ game_max_retries: Math.round(v) })}
              displayValue={String(gameMaxRetries)}
              helperText={t("settings.game_max_retries_hint")}
            />

            <button
              onClick={() => onUpdate(GAME_AI_DEFAULTS)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-foreground hover:bg-elevated border border-border transition-colors self-start"
            >
              <RotateCcw size={12} />
              {t("settings.reset_game_defaults")}
            </button>
          </div>
        )}
      </SettingsCard>

      <GameConnectionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        gameConnectionId={gameConnectionId}
        gameModel={gameModel}
        connections={connections}
        activeConnectionId={activeConnectionId}
        activeConnectionModel={activeConnectionModel}
        onSave={(connId, model) => {
          onUpdate({ game_connection_id: connId, game_model: model });
        }}
      />
    </div>
  );
}
