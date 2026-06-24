import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_CODE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function CodeWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const code = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.code && typeof d.code === "string") return d.code;
    return SAMPLE_CODE;
  }, [d]);

  const lang = (d.language as string) || "rust";

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => code, tip: t("widget.code.copy") },
  ], [code]);

  const { rendered: headerActions } = useHeaderActions(actions);

  const lines = useMemo(() => code.split("\n"), [code]);

  return (
    <ScrollableWidget searchable={false}>
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      <div className="flex">
        {/* Line numbers */}
        <div className="text-right px-2 py-3 text-xs text-muted/40 select-none font-mono leading-5 shrink-0 border-r border-white/5">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* Code */}
        <pre className="flex-1 p-3 text-xs font-mono leading-5 text-fg overflow-x-auto" style={{ whiteSpace: "pre" }}>
          {code}
        </pre>
      </div>
      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-white/5 flex items-center gap-3 text-[10px] text-muted/60">
        <span className="badge">{lang}</span>
        <span>{t("widget.code.lines", { count: lines.length })}</span>
      </div>
    </ScrollableWidget>
  );
}
