import { useMemo, type RefObject } from "react";
import hljs from "highlight.js";

interface Props {
  code: string;
  language?: string;
  isStreaming?: boolean;
  scrollRef?: RefObject<HTMLDivElement>;
}

export function CodeViewer({ code, language, isStreaming, scrollRef }: Props) {
  const lines = useMemo(() => code.split("\n"), [code]);

  const highlighted = useMemo(() => {
    try {
      const lang = language && hljs.getLanguage(language) ? language : undefined;
      if (lang) {
        return hljs.highlight(code, { language: lang }).value;
      }
      const auto = hljs.highlightAuto(code);
      return auto.value;
    } catch {
      return code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [code, language]);

  return (
    <div className="flex bg-[#0d0d0d] min-h-0" ref={scrollRef}>
      <div className="shrink-0 text-right text-white/20 border-r border-white/5 select-none min-w-[3.5ch] px-3 py-3 text-xs font-mono leading-[1.5]">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 m-0 p-3 text-xs font-mono leading-[1.5] hljs overflow-hidden whitespace-pre">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        {isStreaming && <span className="inline-block w-2 h-3.5 bg-accent animate-pulse ml-0.5 align-middle" />}
      </pre>
    </div>
  );
}
