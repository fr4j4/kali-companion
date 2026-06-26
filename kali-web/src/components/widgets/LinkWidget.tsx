import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function LinkWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const url = (d.url as string) || "https://example.com";
  const title = (d.title as string) || t("widget.link.sample");
  const description = (d.description as string) || "";

  return (
    <BaseWidget>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-3 hover:bg-white/[0.02] transition group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <span className="text-sm">{'\u{1F517}'}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-fg truncate group-hover:text-accent transition">{title}</div>
            {description && <div className="text-xs text-muted truncate mt-0.5">{description}</div>}
            <div className="text-[10px] text-accent/60 truncate mt-0.5">{url}</div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </div>
      </a>
    </BaseWidget>
  );
}
