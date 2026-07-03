import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gamepad2, Server, Cloud, Check } from "lucide-react";
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

const DEFAULT_TIMEOUTS = [12_000, 3_000, 2_000];
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 256;

export function GamingSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { connections, chat } = useStage();
  const [advanced, setAdvanced] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const gameSessionPath = systemStatus?.game_session_path ?? "";
  const gameAiGlobalTimeoutMs = systemStatus?.game_ai_global_timeout_ms ?? 20_000;
  const gameConnectionId = systemStatus?.game_connection_id ?? "active";
  const gameModel = systemStatus?.game_model ?? "";
  const gameTemperature = systemStatus?.game_temperature ?? DEFAULT_TEMPERATURE;
  const gameMaxTokens = systemStatus?.game_max_tokens ?? DEFAULT_MAX_TOKENS;
  const timeout1 = systemStatus?.game_retry_timeout_1_ms ?? DEFAULT_TIMEOUTS[0];
  const timeout2 = systemStatus?.game_retry_timeout_2_ms ?? DEFAULT_TIMEOUTS[1];
  const timeout3 = systemStatus?.game_retry_timeout_3_ms ?? DEFAULT_TIMEOUTS[2];
  const gameMaxRetries = systemStatus?.game_max_retries ?? DEFAULT_MAX_RETRIES;

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
              max={1.5}
              step={0.1}
              onChange={(v) => onUpdate({ game_temperature: v })}
              displayValue={gameTemperature.toFixed(1)}
            />

            <SliderField
              label={t("settings.game_max_tokens")}
              value={gameMaxTokens}
              min={16}
              max={4096}
              step={16}
              onChange={(v) => onUpdate({ game_max_tokens: Math.round(v) })}
              displayValue={String(gameMaxTokens)}
            />

            <SliderField
              label={t("settings.game_retry_timeout_1_ms")}
              value={timeout1}
              min={1000}
              max={60_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_1_ms: Math.round(v) })}
              displayValue={`${timeout1}ms`}
            />

            <SliderField
              label={t("settings.game_retry_timeout_2_ms")}
              value={timeout2}
              min={1000}
              max={30_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_2_ms: Math.round(v) })}
              displayValue={`${timeout2}ms`}
            />

            <SliderField
              label={t("settings.game_retry_timeout_3_ms")}
              value={timeout3}
              min={1000}
              max={20_000}
              step={1000}
              onChange={(v) => onUpdate({ game_retry_timeout_3_ms: Math.round(v) })}
              displayValue={`${timeout3}ms`}
            />

            <SliderField
              label={t("settings.game_max_retries")}
              value={gameMaxRetries}
              min={1}
              max={5}
              step={1}
              onChange={(v) => onUpdate({ game_max_retries: Math.round(v) })}
              displayValue={String(gameMaxRetries)}
            />
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
