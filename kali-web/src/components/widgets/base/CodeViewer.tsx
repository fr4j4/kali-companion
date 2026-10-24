import { useMemo, type RefObject } from "react";
import hljs from "highlight.js";
import { sanitizeHtml } from "../../../lib/markdown";

interface Props {
  code: string;
  language?: string;
  isStreaming?: boolean;
  scrollRef?: RefObject<HTMLDivElement>;
  /** 1-based lines Kali changed: a bar at the edge of the gutter marks them. */
  changed?: number[];
}

export function CodeViewer({ code, language, isStreaming, scrollRef, changed }: Props) {
  const lines = useMemo(() => code.split("\n"), [code]);
  const marks = useMemo(() => new Set(changed ?? []), [changed]);

  const highlighted = useMemo(() => {
    try {
      const lang = language && hljs.getLanguage(language) ? language : undefined;
      if (lang) {
        return sanitizeHtml(hljs.highlight(code, { language: lang }).value);
      }
      return sanitizeHtml(hljs.highlightAuto(code).value);
    } catch {
      return code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [code, language]);

  return (
    <div className="kw-codeview flex bg-[var(--code-bg)] min-h-0" ref={scrollRef}>
      <div className="kw-gutter shrink-0 text-right text-fg/20 border-r border-fg/5 select-none min-w-[3.5ch] px-3 py-3 text-xs font-mono leading-[1.5]" aria-hidden="true">
        {lines.map((_, i) => (
          <div key={i} className={marks.has(i + 1) ? "is-changed" : undefined}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 m-0 p-3 text-xs font-mono leading-[1.5] hljs overflow-hidden whitespace-pre">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        {isStreaming && <span className="kw-kali-cursor" aria-hidden="true">Kali</span>}
      </pre>
    </div>
  );
}
