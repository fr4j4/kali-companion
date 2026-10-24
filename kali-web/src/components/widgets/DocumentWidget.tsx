/**
 * DocumentWidget — text to read calmly and decide on Kali's changes.
 *
 * Serif text with an index of its headings at the side (when there are a few and room for it).
 * Suggestions (`suggestions: [{ id, old, new, note? }]`, sent by update_artifact in suggestion
 * mode) show in the text as struck-out and underlined, with a card in the margin to accept or
 * discard each one; the decision goes back to the core, which applies it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_DOCUMENT, SAMPLE_LONGTEXT } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useStage } from "../../stage/StageProvider";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
  variant?: "markdown" | "prose" | "transcript";
}

export interface DocSuggestion { id: string; old: string; new: string; note?: string }

export function headingsOf(md: string): { level: number; text: string; slug: string }[] {
  const out: { level: number; text: string; slug: string }[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[*_`]/g, "");
      out.push({ level: m[1].length, text, slug: `h-${out.length}` });
    }
  }
  return out;
}

export function wordCount(md: string): number {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/[#*>`_\-[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Mark each pending suggestion inside the rendered HTML (first occurrence of its old text). */
export function markSuggestions(html: string, suggestions: DocSuggestion[]): string {
  let out = html;
  for (const s of suggestions) {
    const old = escapeHtml(s.old);
    const at = old ? out.indexOf(old) : -1;
    const ins = `<ins class="kw-sug-new" data-sug="${escapeHtml(s.id)}">${escapeHtml(s.new)}</ins>`;
    if (at >= 0) out = `${out.slice(0, at)}<del class="kw-sug-old" data-sug="${escapeHtml(s.id)}">${old}</del>${ins}${out.slice(at + old.length)}`;
  }
  return out;
}

export function DocumentWidget({ content, variant = "markdown" }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const event = content as ArtifactEvent | undefined;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [decided, setDecided] = useState<Record<string, "accept" | "discard">>({});

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sample text only outside a real artifact (a real one still streaming starts empty).
  const sample = !isReal;
  const rawText = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.content && typeof d.content === "string") return d.content;
    if (isReal) return "";
    if (variant === "transcript") return SAMPLE_LONGTEXT;
    return SAMPLE_DOCUMENT;
  }, [d, variant, isReal]);

  const suggestions = useMemo(() => {
    const list = typeof d === "object" && Array.isArray(d.suggestions) ? (d.suggestions as DocSuggestion[]) : [];
    return list.filter((s) => s && typeof s.id === "string" && typeof s.old === "string" && typeof s.new === "string" && !decided[s.id]);
  }, [d, decided]);

  const heads = useMemo(() => (variant === "markdown" ? headingsOf(rawText) : []), [rawText, variant]);
  const html = useMemo(() => {
    if (variant !== "markdown") return null;
    let h = renderMarkdown(rawText);
    // Anchor headings in order so the index can scroll to them.
    let i = 0;
    h = h.replace(/<h([1-3])(\s[^>]*)?>/g, (_m, lvl, attrs = "") => `<h${lvl}${attrs} id="h-${i++}">`);
    return suggestions.length ? markSuggestions(h, suggestions) : h;
  }, [rawText, variant, suggestions]);

  const words = useMemo(() => wordCount(rawText), [rawText]);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => rawText, tip: t("widget.document.copy") },
    { type: "download", content: rawText, filename: `${(event?.title || "document").replace(/[^\w\-. ]+/g, "")}.md`, tip: t("widget.document.download") },
  ], [rawText, t, event?.title]);
  const { rendered: headerActions } = useHeaderActions(actions);

  useShellSubtitle(variant === "markdown" ? t("v2.subtitle.words", { count: words }) : null);
  useShellSample(sample);

  const decide = useCallback((s: DocSuggestion, decision: "accept" | "discard") => {
    setDecided((m) => ({ ...m, [s.id]: decision }));
    if (event?.id) {
      chat.sendEvent({ event: "artifact_suggestion", artifact_id: event.id, suggestion_id: s.id, decision });
    }
  }, [chat, event?.id]);

  const showIndex = heads.length >= 3 && width >= 640 && !compact;
  const showMargin = suggestions.length > 0 && width >= 560 && !compact;

  const scrollTo = (slug: string) => {
    bodyRef.current?.querySelector(`#${slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (variant === "markdown") {
    return (
      <ScrollableWidget searchable={false} content={content} autoScroll>
        <WidgetToolbar>{headerActions}</WidgetToolbar>
        <div ref={bodyRef} className="kw-doc">
          {showIndex && (
            <nav className="kw-doc-index" aria-label={t("v2.doc.index") as string}>
              <div className="kw-side-title">{t("v2.doc.index")}</div>
              {heads.map((h, i) => (
                <button key={h.slug} type="button" className="kw-index-item" style={{ paddingLeft: 8 + (h.level - 1) * 10 }} onClick={() => scrollTo(h.slug)}>
                  {i + 1}. {h.text}
                </button>
              ))}
            </nav>
          )}
          <article className="kw-doc-text prose-md" dangerouslySetInnerHTML={{ __html: html || `<p>${escapeHtml(rawText)}</p>` }} />
          {suggestions.length > 0 && (
            <aside className={showMargin ? "kw-doc-margin" : "kw-doc-margin is-inline"} aria-label={t("v2.doc.suggestions") as string}>
              {suggestions.map((s) => (
                <div key={s.id} className="kw-sug-card">
                  <div className="kw-sug-title"><MessageSquare size={14} aria-hidden="true" />{t("v2.doc.kali_suggests")}</div>
                  <p>{s.note || t("v2.doc.change", { old: s.old, new: s.new })}</p>
                  <div className="flex gap-2">
                    <button type="button" className="v2-btn is-primary" onClick={() => decide(s, "accept")}>{t("v2.doc.accept")}</button>
                    <button type="button" className="v2-btn is-quiet" onClick={() => decide(s, "discard")}>{t("v2.doc.discard")}</button>
                  </div>
                </div>
              ))}
            </aside>
          )}
        </div>
        <WidgetFooter>
          <span className="v2-foot-item">{t("v2.subtitle.words", { count: words })}</span>
          {suggestions.length > 0 && <span className="v2-foot-item is-warn">{t("v2.doc.pending", { count: suggestions.length })}</span>}
        </WidgetFooter>
      </ScrollableWidget>
    );
  }

  if (variant === "prose") {
    return (
      <ScrollableWidget searchable={false} content={content} autoScroll>
        <div className="kw-doc">
          <div className="kw-doc-text prose-md">
            <p className="text-muted leading-relaxed">{rawText}</p>
          </div>
        </div>
      </ScrollableWidget>
    );
  }

  /* transcript */
  return (
    <ScrollableWidget searchable={true} content={content} autoScroll>
      <div className="p-3">
        <pre className="term-line text-muted whitespace-pre-wrap">{rawText}</pre>
      </div>
    </ScrollableWidget>
  );
}
