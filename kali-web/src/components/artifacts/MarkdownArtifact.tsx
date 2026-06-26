import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import mermaid from "mermaid";

mermaid.initialize({
  theme: "base",
  themeVariables: {
    background: "transparent",
    primaryColor: "#3b82f6",
    primaryTextColor: "#e2e8f0",
    primaryBorderColor: "#475569",
    lineColor: "#64748b",
    secondaryColor: "#1e293b",
    tertiaryColor: "#0f172a",
  },
  fontFamily: "ui-monospace, monospace",
});

interface Props {
  content: string;
}

export function MarkdownArtifact({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content]);

  useEffect(() => {
    if (!containerRef.current) return;
    const mermaidBlocks = containerRef.current.querySelectorAll<HTMLElement>("code.language-mermaid");
    if (mermaidBlocks.length === 0) return;

    mermaidBlocks.forEach((block, idx) => {
      const definition = block.textContent ?? "";
      const pre = block.closest("pre");
      if (!pre) return;

      const id = `mermaid-${idx}-${Date.now()}`;
      mermaid
        .render(id, definition)
        .then(({ svg }) => {
          pre.outerHTML = svg;
        })
        .catch(() => {
          pre.outerHTML = `<pre class="text-err text-xs p-2 border border-err/30 rounded">Failed to render diagram</pre>`;
        });
    });
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="p-4 overflow-x-auto markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
