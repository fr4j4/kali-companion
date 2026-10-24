/**
 * stage/v2/KaliZone.tsx — What Kali says and asks, around the map.
 *
 *  - VoiceLine: the echo of what you said (italic) and her answer (serif) with a cursor while she
 *    writes; the welcome when the session is empty.
 *  - ConsentCard: the permission question, in Kali's zone instead of a modal over everything.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { consentTexts } from "../../lib/consentText";
import type { ConsentDecision, ConsentRequestEvent } from "../../lib/protocol";
import { useStage } from "../StageProvider";

// ── Voice ───────────────────────────────────────────────

const WELCOME_PROMPTS = ["welcome.prompt_explain", "welcome.prompt_code", "welcome.prompt_plan", "welcome.prompt_play"] as const;

/** Last user message and Kali's last answer. */
export function useVoice() {
  const { chat } = useStage();
  return useMemo(() => {
    let answer = "";
    let streaming = false;
    let echo = "";
    const ms = chat.messages;
    let i = ms.length - 1;
    for (; i >= 0; i--) {
      const m = ms[i];
      if (m.role === "assistant" && m.content) { answer = m.content; streaming = !!m.streaming; break; }
      if (m.role === "user" && m.content) { echo = m.content; answer = ""; break; }
    }
    if (!echo) for (let j = i - 1; j >= 0; j--) { if (ms[j].role === "user" && ms[j].content) { echo = ms[j].content; break; } }
    return { echo, answer, streaming, empty: ms.length === 0 };
  }, [chat.messages]);
}

export function VoiceText({ answer, streaming }: { answer: string; streaming: boolean }) {
  const html = useMemo(() => (answer ? renderMarkdown(answer.replace(/\n{3,}/g, "\n\n")) : ""), [answer]);
  return (
    <div className={`v2-voice-text ${streaming ? "is-streaming" : ""}`}>
      {html && <span dangerouslySetInnerHTML={{ __html: html }} />}
      {streaming && <span className="v2-cursor is-blinking" aria-hidden="true" />}
    </div>
  );
}

export function VoiceLine({ style }: { style: CSSProperties }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { echo, answer, streaming, empty } = useVoice();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el && streaming) el.scrollTop = el.scrollHeight; }, [answer, streaming]);

  if (empty && !chat.isTurnActive) {
    return (
      <div className="v2-voice" style={style}>
        <div className="v2-voice-scroll flex flex-col items-center gap-3">
          <div>
            <h1 className="v2-serif" style={{ margin: 0, fontSize: "max(16px, calc(24px * var(--kt)))", fontWeight: 600 }}>{t("welcome.title")}</h1>
            <p className="v2-t13" style={{ margin: "4px 0 0", color: "var(--muted)" }}>{t("stage.empty_state")}</p>
          </div>
          <ul className="flex flex-wrap justify-center gap-2" aria-label={t("welcome.suggestions") as string} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {WELCOME_PROMPTS.map((key) => (
              <li key={key}><button type="button" className="v2-btn" style={{ borderRadius: 9999 }} onClick={() => chat.send(t(key) as string)}>{t(key)}</button></li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="v2-voice" style={style} aria-live="polite">
      <div className="v2-voice-scroll" ref={ref}>
        {echo && <div className="v2-echo">“{echo}”</div>}
        {answer ? <VoiceText answer={answer} streaming={streaming} /> : chat.isThinking && <div className="v2-t13" style={{ color: "var(--muted)" }}>{t("stage.thinking")}</div>}
      </div>
    </div>
  );
}

// ── Consent ─────────────────────────────────────────────

export const CONSENT_SECONDS = 60;

export function ConsentCard({ request, onRespond, style }: {
  request: ConsentRequestEvent;
  onRespond: (id: string, decision: ConsentDecision) => void;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(CONSENT_SECONDS);
  const allowRef = useRef<HTMLButtonElement>(null);
  const { summary, reason, command } = consentTexts(request, t as never);

  useEffect(() => {
    setLeft(CONSENT_SECONDS);
    allowRef.current?.focus({ preventScroll: true });
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = CONSENT_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) { window.clearInterval(timer); onRespond(request.id, "deny"); }
      setLeft(Math.max(0, remaining));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request, onRespond]);

  return (
    <div
      className="v2-consent v2-enter"
      style={style}
      role="alertdialog"
      aria-label={summary}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onRespond(request.id, "deny"); } }}
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion size={18} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
        <div className="min-w-0 flex-1">
          <h3>{summary}</h3>
          {reason && <p>{reason}</p>}
        </div>
        <span className="v2-kbd" aria-label={t("v2.consent.seconds_left", { count: left }) as string}>{left}s</span>
      </div>
      {command && <pre>{command}</pre>}
      <div className="v2-consent-actions">
        <button ref={allowRef} type="button" className="v2-btn is-primary" onClick={() => onRespond(request.id, "allow")}>{t("consent.allow_once")}</button>
        <button type="button" className="v2-btn" title={t("consent.allow_always_hint") as string} onClick={() => onRespond(request.id, "allow_session")}>{t("consent.allow_always")}</button>
        <button type="button" className="v2-btn is-quiet" onClick={() => onRespond(request.id, "deny")}>{t("consent.deny")}</button>
        <span className="v2-kbd">{t("v2.consent.keys")}</span>
      </div>
    </div>
  );
}
