/**
 * stage/StageDock.tsx — Bottom pill of the neural canvas (desktop).
 *
 * Microphone, "look at my screen", the message field and send in one glass pill, as in the design.
 * Everything else the old dock carried (games, layouts, audio, undo, debug, clear) lives in the
 * overflow menu. Narrow screens keep `NeuralDock`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Bug, Gamepad2, House, LayoutGrid, Mic, MoreHorizontal, Monitor, Square, Trash2, Undo2, Volume2, X } from "lucide-react";
import { useStage } from "./StageProvider";
import type { WorkspaceAPI } from "../workspace/types";

interface Props {
  api: WorkspaceAPI;
  onToggleDebug?: () => void;
  /** The docked conversation panel has its own composer; leave "type anywhere" to it. */
  yieldTyping: boolean;
  onTypingChange: (typing: boolean) => void;
  /** Neural canvas v2: the layout menu carries games, undo and debug, so the overflow menu goes. */
  minimal?: boolean;
  /** Narrow composer (Kali's column, the bubble): no "look at my screen" button. */
  compact?: boolean;
}

export function StageDock({ api, onToggleDebug, yieldTyping, onTypingChange, minimal = false, compact = false }: Props) {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isRecording = ptt.state === "recording";
  const busy = chat.isTurnActive;
  const sttEnabled = chat.systemStatus?.stt_enabled ?? true;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  useEffect(() => {
    if (yieldTyping) return;
    const focus = () => taRef.current?.focus();
    window.addEventListener("kali:chat-focus", focus);
    return () => window.removeEventListener("kali:chat-focus", focus);
  }, [yieldTyping]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  useEffect(() => () => onTypingChange(false), [onTypingChange]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || busy) return;
    chat.send(text);
    setValue("");
    onTypingChange(false);
  }, [value, busy, chat, onTypingChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === "Escape") taRef.current?.blur();
  };

  const run = (fn: () => void) => () => { fn(); setMenuOpen(false); };
  const openToys = () => {
    const existing = api.windows.find((w) => w.type === "game" && (w.content as { mode?: string } | null)?.mode === "launchpad");
    if (existing && !existing.closed) { api.focusWindow(existing.id); return; }
    api.createWindow("game", { title: t("dock.toys"), icon: "\u{1F3AE}", content: { mode: "launchpad" }, resizable: true, minW: 360, minH: 400 });
  };

  const micLabel = !sttEnabled ? t("dock.mic_disabled") : isRecording ? t("dock.mic_stop") : t("dock.mic_label");

  return (
    <footer className="stage-dock neural-dock" aria-label={t("dock.label") as string}>
      <div className="stage-dock-pill">
        <button
          type="button"
          className={`sd-btn ${isRecording ? "is-rec" : ""}`}
          onClick={() => (isRecording ? ptt.stop() : ptt.start())}
          disabled={!sttEnabled}
          aria-label={micLabel as string}
          title={micLabel as string}
          aria-pressed={isRecording}
        >
          <Mic size={18} aria-hidden="true" />
        </button>
        {isRecording && (
          <button type="button" className="sd-btn" onClick={ptt.cancel} aria-label={t("dock.mic_cancel") as string} title={t("dock.mic_cancel") as string}>
            <X size={18} aria-hidden="true" />
          </button>
        )}
        {!compact && <button
          type="button"
          className="sd-btn"
          onClick={() => chat.send(t("dock.look_screen_prompt") as string)}
          disabled={busy || isRecording}
          aria-label={t("dock.look_screen") as string}
          title={t("dock.look_screen") as string}
        >
          <Monitor size={18} aria-hidden="true" />
        </button>}
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => { setValue(e.target.value); onTypingChange(e.target.value.length > 0); }}
          onKeyDown={onKeyDown}
          onBlur={() => onTypingChange(false)}
          placeholder={isRecording ? (t("dock.listening") as string) : (t("dock.placeholder") as string)}
          aria-label={t("dock.placeholder") as string}
          className="sd-input"
        />
        {!minimal && <div className="relative" ref={menuRef}>
          <button type="button" className="sd-btn" onClick={() => setMenuOpen((v) => !v)} aria-label={t("dock.overflow") as string} title={t("dock.overflow") as string} aria-expanded={menuOpen} aria-haspopup="menu">
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="ctx-menu absolute bottom-12 right-0 min-w-[180px]" role="menu">
              <button role="menuitem" className="ctx-item w-full" onClick={run(openToys)}><Gamepad2 size={14} />{t("dock.toys")}</button>
              <button role="menuitem" className="ctx-item w-full" onClick={run(api.toggleGrid)}><LayoutGrid size={14} />{t("dock.grid")}</button>
              <button role="menuitem" className="ctx-item w-full" onClick={run(api.focusLast)}><House size={14} />{t("dock.focus")}</button>
              <button role="menuitem" className="ctx-item w-full" onClick={run(api.toggleAudio)}><Volume2 size={14} />{t("dock.audio")}</button>
              <button role="menuitem" className="ctx-item w-full" onClick={run(api.undo)}><Undo2 size={14} />{t("dock.undo")}</button>
              {import.meta.env.DEV && (
                <>
                  <div className="ctx-sep" />
                  <button role="menuitem" className="ctx-item w-full" onClick={run(() => onToggleDebug?.())}><Bug size={14} />{t("dock.debug")}</button>
                </>
              )}
              <div className="ctx-sep" />
              <button role="menuitem" className="ctx-item danger w-full" onClick={run(api.clearAll)}><Trash2 size={14} />{t("dock.clear")}</button>
            </div>
          )}
        </div>}
        {busy ? (
          <button type="button" className="sd-send is-stop" onClick={chat.stop} aria-label={t("chat.stop") as string} title={t("chat.stop") as string}>
            <Square size={12} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="sd-send" onClick={submit} disabled={!value.trim()} aria-label={t("chat.send") as string} title={t("chat.send") as string}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </footer>
  );
}
