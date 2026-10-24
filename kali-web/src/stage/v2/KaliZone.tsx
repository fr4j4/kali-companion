/**
 * stage/v2/KaliZone.tsx — What Kali says and asks, around the map.
 *
 *  - VoiceLine: the echo of what you said (italic) and her answer (serif) with a cursor while she
 *    writes; the welcome when the session is empty.
 *  - Inspector: one line under the map with the node that matters now (permission, error,
 *    working…, or the one you picked) and "See detail".
 *  - ConsentCard: the permission question, in Kali's zone instead of a modal over everything.
 *  - NowList: "Now · <group>", the nodes that are busy, for the column and the bubble.
 *  - ConversationPanel: the conversation view of Kali's zone.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { consentTexts } from "../../lib/consentText";
import type { ConsentDecision, ConsentRequestEvent } from "../../lib/protocol";
import { useStage } from "../StageProvider";
import { ConversationLog } from "../ConversationLog";
import { inspectorNode, type NodeId, type NodeStatus } from "./mapModel";
import { NODE_ICONS } from "./nodeIcons";
import { motiveText, stateWord } from "./NeuralMapV2";

const STATE_VAR: Record<string, string> = {
  idle: "var(--muted)", working: "var(--accent)", recalling: "var(--accent2)", permission: "var(--accent)", failed: "var(--err)", done: "var(--ok)",
};

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

// ── Inspector ───────────────────────────────────────────

export function Inspector({ statuses, picked, onDetail, style }: {
  statuses: Record<string, NodeStatus>;
  picked: NodeId | null;
  onDetail: (st: NodeStatus) => void;
  style: CSSProperties;
}) {
  const { t } = useTranslation();
  const st = inspectorNode(statuses, picked);
  if (!st) {
    return (
      <div className="v2-inspector" style={style}>
        <span className="v2-inspector-motive">{t("v2.inspector.idle")}</span>
      </div>
    );
  }
  const Icon = NODE_ICONS[st.id];
  const motive = motiveText(t as never, st);
  return (
    <div className={`v2-inspector ${st.state !== "idle" ? "is-active" : ""}`} style={{ ...style, ["--c" as string]: STATE_VAR[st.state] }} role="status">
      <Icon size={18} aria-hidden="true" style={{ color: STATE_VAR[st.state], flexShrink: 0 }} />
      <span className="v2-inspector-title">{t(`v2.node.${st.id}`)} · <span className="v2-word">{stateWord(t as never, st)}</span></span>
      <span className="v2-inspector-motive min-w-0 flex-1" title={motive}>{motive}</span>
      <button type="button" className="v2-btn is-quiet" onClick={() => onDetail(st)}>{t("v2.inspector.detail")}</button>
    </div>
  );
}

// ── Now list ────────────────────────────────────────────

export function NowList({ statuses, groupTitle, onPick }: { statuses: Record<string, NodeStatus>; groupTitle?: string; onPick: (id: NodeId) => void }) {
  const { t } = useTranslation();
  const busy = Object.values(statuses).filter((s) => s.state !== "idle").sort((a, b) => b.since - a.since).slice(0, 5);
  return (
    <div>
      <div className="v2-now-title">{groupTitle ? t("v2.now.title_group", { group: groupTitle }) : t("v2.now.title")}</div>
      {busy.length === 0 ? (
        <p className="v2-t12" style={{ color: "var(--muted)", margin: "6px 0 0" }}>{t("v2.inspector.idle")}</p>
      ) : (
        <ul className="v2-now-list" style={{ marginTop: 6 }}>
          {busy.map((s) => {
            const Icon = NODE_ICONS[s.id];
            return (
              <li key={s.id} style={{ ["--c" as string]: STATE_VAR[s.state] }}>
                <button type="button" onClick={() => onPick(s.id)} className="min-w-0">
                  <Icon size={14} aria-hidden="true" style={{ color: STATE_VAR[s.state] }} />
                  <span className="truncate">{t(`v2.node.${s.id}`)}</span>
                  <span className="v2-word truncate">{stateWord(t as never, s)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

// ── Conversation view ───────────────────────────────────

export function ConversationPanel({ style }: { style: CSSProperties }) {
  return (
    <div className="v2-convo" style={style}>
      <ConversationLog />
    </div>
  );
}
