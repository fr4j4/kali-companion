import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { marked } from "marked";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_DOCUMENT, SAMPLE_LONGTEXT } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
  variant?: "markdown" | "prose" | "transcript";
}

export function DocumentWidget({ content, variant = "markdown" }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;

  const rawText = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.content && typeof d.content === "string") return d.content;
    if (variant === "transcript") return SAMPLE_LONGTEXT;
    return SAMPLE_DOCUMENT;
  }, [d, variant]);

  const html = useMemo(() => {
    if (variant !== "markdown") return null;
    try {
      return marked.parse(rawText, { async: false }) as string;
    } catch {
      return `<p>${rawText}</p>`;
    }
  }, [rawText, variant]);

  const actions: HeaderAction[] = useMemo(() => {
    const acts: HeaderAction[] = [];
    acts.push({ type: "copy", getContent: () => rawText, tip: t("widget.document.copy") });
    acts.push({ type: "download", content: rawText, filename: "document.md", tip: t("widget.document.download") });
    return acts;
  }, [rawText]);

  const { rendered: headerActions } = useHeaderActions(actions);

  if (variant === "markdown") {
    return (
      <ScrollableWidget searchable={false}>
        {headerActions.length > 0 && (
          <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
            {headerActions}
          </div>
        )}
        <div className="p-4">
          <div
            className="prose-md"
            dangerouslySetInnerHTML={{ __html: html || `<p>${rawText}</p>` }}
          />
        </div>
      </ScrollableWidget>
    );
  }

  if (variant === "prose") {
    return (
      <ScrollableWidget searchable={false}>
        <div className="p-4">
          <div className="prose-md">
            <p className="text-muted leading-relaxed">{rawText}</p>
          </div>
        </div>
      </ScrollableWidget>
    );
  }

  /* transcript */
  return (
    <ScrollableWidget searchable={true}>
      <div className="p-3">
        <pre className="term-line text-xs text-muted whitespace-pre-wrap">{rawText}</pre>
      </div>
    </ScrollableWidget>
  );
}
