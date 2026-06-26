import { useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { CodeViewer } from "./base/CodeViewer";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_CODE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
}

export function CodeWidget({ content }: Props) {
  const { t } = useTranslation();
  const event = content as ArtifactEvent | undefined;
  const isStreaming = event?.phase === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const code = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.code && typeof d.code === "string") return d.code;
    return SAMPLE_CODE;
  }, [d]);

  const lang = (d.language as string) || "";

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => code, tip: t("widget.code.copy") },
  ], [code]);

  const { rendered: headerActions } = useHeaderActions(actions);

  const lines = useMemo(() => code.split("\n"), [code]);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [code, isStreaming]);

  return (
    <BaseWidget content={content} className="overflow-hidden">
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        <CodeViewer code={code} language={lang} isStreaming={isStreaming} />
      </div>
      <div className="shrink-0 px-3 py-1.5 border-t border-white/5 flex items-center gap-3 text-[10px] text-muted/60">
        <span className="badge">{lang || "code"}</span>
        <span>{t("widget.code.lines", { count: lines.length })}</span>
      </div>
    </BaseWidget>
  );
}
