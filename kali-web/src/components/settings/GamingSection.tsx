import { useCallback, useEffect, useRef, useState } from "react";
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
  game_ai_enabled: true,
  game_log_default_open: false,
  game_reasoning_default_open: false,
};

export function GamingSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { connections, chat } = useStage();
  const [advanced, setAdvanced] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Non-slider values (discrete controls) — keep derived from server.
  const gameSessionPath = systemStatus?.game_session_path ?? GAME_AI_DEFAULTS.game_session_path;
  const gameConnectionId = systemStatus?.game_connection_id ?? GAME_AI_DEFAULTS.game_connection_id;
  const gameModel = systemStatus?.game_model ?? GAME_AI_DEFAULTS.game_model;
  const gameAiEnabled = systemStatus?.game_ai_enabled ?? GAME_AI_DEFAULTS.game_ai_enabled;
  const gameLogDefaultOpen = systemStatus?.game_log_default_open ?? GAME_AI_DEFAULTS.game_log_default_open;
  const gameReasoningDefaultOpen = systemStatus?.game_reasoning_default_open ?? GAME_AI_DEFAULTS.game_reasoning_default_open;

  // Local state + debounce for sliders (avoids WS chatter and gives instant feedback on drag).
  const [localGameTimeout, setLocalGameTimeout] = useState(
    systemStatus?.game_ai_global_timeout_ms ?? GAME_AI_DEFAULTS.game_ai_global_timeout_ms
  );
  const [localGameTemperature, setLocalGameTemperature] = useState(
    systemStatus?.game_temperature ?? GAME_AI_DEFAULTS.game_temperature
  );
  const [localGameMaxTokens, setLocalGameMaxTokens] = useState(
    systemStatus?.game_max_tokens ?? GAME_AI_DEFAULTS.game_max_tokens
  );
  const [localTimeout1, setLocalTimeout1] = useState(
    systemStatus?.game_retry_timeout_1_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_1_ms
  );
  const [localTimeout2, setLocalTimeout2] = useState(
    systemStatus?.game_retry_timeout_2_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_2_ms
  );
  const [localTimeout3, setLocalTimeout3] = useState(
    systemStatus?.game_retry_timeout_3_ms ?? GAME_AI_DEFAULTS.game_retry_timeout_3_ms
  );
  const [localMaxRetries, setLocalMaxRetries] = useState(
    systemStatus?.game_max_retries ?? GAME_AI_DEFAULTS.game_max_retries
  );

  const gameTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const gameTemperatureRef = useRef<ReturnType<typeof setTimeout>>();
  const gameMaxTokensRef = useRef<ReturnType<typeof setTimeout>>();
  const timeout1Ref = useRef<ReturnType<typeof setTimeout>>();
  const timeout2Ref = useRef<ReturnType<typeof setTimeout>>();
  const timeout3Ref = useRef<ReturnType<typeof setTimeout>>();
  const maxRetriesRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync sliders from server.
  useEffect(() => { const v = systemStatus?.game_ai_global_timeout_ms; if (v != null) setLocalGameTimeout(v); }, [systemStatus?.game_ai_global_timeout_ms]);
  useEffect(() => { const v = systemStatus?.game_temperature; if (v != null) setLocalGameTemperature(v); }, [systemStatus?.game_temperature]);
  useEffect(() => { const v = systemStatus?.game_max_tokens; if (v != null) setLocalGameMaxTokens(v); }, [systemStatus?.game_max_tokens]);
  useEffect(() => { const v = systemStatus?.game_retry_timeout_1_ms; if (v != null) setLocalTimeout1(v); }, [systemStatus?.game_retry_timeout_1_ms]);
  useEffect(() => { const v = systemStatus?.game_retry_timeout_2_ms; if (v != null) setLocalTimeout2(v); }, [systemStatus?.game_retry_timeout_2_ms]);
  useEffect(() => { const v = systemStatus?.game_retry_timeout_3_ms; if (v != null) setLocalTimeout3(v); }, [systemStatus?.game_retry_timeout_3_ms]);
  useEffect(() => { const v = systemStatus?.game_max_retries; if (v != null) setLocalMaxRetries(v); }, [systemStatus?.game_max_retries]);

  // Cleanup debounce timers on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(gameTimeoutRef.current);
      clearTimeout(gameTemperatureRef.current);
      clearTimeout(gameMaxTokensRef.current);
      clearTimeout(timeout1Ref.current);
      clearTimeout(timeout2Ref.current);
      clearTimeout(timeout3Ref.current);
      clearTimeout(maxRetriesRef.current);
    };
  }, []);

  const handleGameTimeoutChange = useCallback((v: number) => {
    const ms = Math.round(v * 1000);
    setLocalGameTimeout(ms);
    clearTimeout(gameTimeoutRef.current);
    gameTimeoutRef.current = setTimeout(() => onUpdate({ game_ai_global_timeout_ms: ms }), 300);
  }, [onUpdate]);

  const handleGameTemperatureChange = useCallback((v: number) => {
    setLocalGameTemperature(v);
    clearTimeout(gameTemperatureRef.current);
    gameTemperatureRef.current = setTimeout(() => onUpdate({ game_temperature: v }), 300);
  }, [onUpdate]);

  const handleGameMaxTokensChange = useCallback((v: number) => {
    const next = Math.round(v);
    setLocalGameMaxTokens(next);
    clearTimeout(gameMaxTokensRef.current);
    gameMaxTokensRef.current = setTimeout(() => onUpdate({ game_max_tokens: next }), 300);
  }, [onUpdate]);

  const handleRetryTimeout1Change = useCallback((v: number) => {
    const next = Math.round(v);
    setLocalTimeout1(next);
    clearTimeout(timeout1Ref.current);
    timeout1Ref.current = setTimeout(() => onUpdate({ game_retry_timeout_1_ms: next }), 300);
  }, [onUpdate]);

  const handleRetryTimeout2Change = useCallback((v: number) => {
    const next = Math.round(v);
    setLocalTimeout2(next);
    clearTimeout(timeout2Ref.current);
    timeout2Ref.current = setTimeout(() => onUpdate({ game_retry_timeout_2_ms: next }), 300);
  }, [onUpdate]);

  const handleRetryTimeout3Change = useCallback((v: number) => {
    const next = Math.round(v);
    setLocalTimeout3(next);
    clearTimeout(timeout3Ref.current);
    timeout3Ref.current = setTimeout(() => onUpdate({ game_retry_timeout_3_ms: next }), 300);
  }, [onUpdate]);

  const handleMaxRetriesChange = useCallback((v: number) => {
    const next = Math.round(v);
    setLocalMaxRetries(next);
    clearTimeout(maxRetriesRef.current);
    maxRetriesRef.current = setTimeout(() => onUpdate({ game_max_retries: next }), 300);
  }, [onUpdate]);

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

      <SettingsCard title={t("settings.gaming.display_group")}>
        <TextField
          label={t("settings.game_session_path")}
          value={gameSessionPath}
          onChange={(v) => onUpdate({ game_session_path: v })}
          placeholder="~/.kali/game-sessions"
          helperText={t("settings.game_session_path_hint")}
        />
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

      <SettingsCard title={t("settings.game_ai_title")}>
        <ToggleField
          label={t("settings.game_ai_enabled")}
          checked={gameAiEnabled}
          onChange={(v) => onUpdate({ game_ai_enabled: v })}
          helperText={t("settings.game_ai_enabled_hint")}
        />

        {gameAiEnabled && (
          <>
            <div className="h-px bg-border/40" />

            <div className="flex flex-col gap-4">
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

              <SliderField
                label={t("settings.game_ai_global_timeout_ms")}
                value={localGameTimeout / 1000}
                min={5}
                max={120}
                step={5}
                onChange={handleGameTimeoutChange}
                displayValue={`${(localGameTimeout / 1000).toFixed(0)}${t("common.seconds_abbrev")}`}
                helperText={t("settings.game_ai_global_timeout_ms_hint")}
              />

              <div className="h-px bg-border/40" />

              <ToggleField
                label={t("settings.advanced_configuration")}
                checked={advanced}
                onChange={setAdvanced}
              />

              {advanced && (
                <div className="flex flex-col gap-4 pl-3 border-l-2 border-border">
                  <SliderField
                    label={t("settings.game_temperature")}
                    value={localGameTemperature}
                    min={0}
                    max={2.0}
                    step={0.1}
                    onChange={handleGameTemperatureChange}
                    displayValue={localGameTemperature.toFixed(1)}
                    helperText={t("settings.game_temperature_hint")}
                  />

                  <SliderField
                    label={t("settings.game_max_tokens")}
                    value={localGameMaxTokens}
                    min={128}
                    max={2048}
                    step={32}
                    onChange={handleGameMaxTokensChange}
                    displayValue={String(localGameMaxTokens)}
                    helperText={t("settings.game_max_tokens_hint")}
                  />

                  <SliderField
                    label={t("settings.game_retry_timeout_1_ms")}
                    value={localTimeout1}
                    min={2000}
                    max={60_000}
                    step={1000}
                    onChange={handleRetryTimeout1Change}
                    displayValue={`${localTimeout1}ms`}
                    helperText={t("settings.game_retry_timeout_1_ms_hint")}
                  />

                  <SliderField
                    label={t("settings.game_retry_timeout_2_ms")}
                    value={localTimeout2}
                    min={2000}
                    max={30_000}
                    step={1000}
                    onChange={handleRetryTimeout2Change}
                    displayValue={`${localTimeout2}ms`}
                    helperText={t("settings.game_retry_timeout_2_ms_hint")}
                  />

                  <SliderField
                    label={t("settings.game_retry_timeout_3_ms")}
                    value={localTimeout3}
                    min={2000}
                    max={20_000}
                    step={1000}
                    onChange={handleRetryTimeout3Change}
                    displayValue={`${localTimeout3}ms`}
                    helperText={t("settings.game_retry_timeout_3_ms_hint")}
                  />

                  <SliderField
                    label={t("settings.game_max_retries")}
                    value={localMaxRetries}
                    min={1}
                    max={5}
                    step={1}
                    onChange={handleMaxRetriesChange}
                    displayValue={String(localMaxRetries)}
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
            </div>
          </>
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
