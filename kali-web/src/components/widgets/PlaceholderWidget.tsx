import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";

interface Props {
  content?: unknown;
}

export function PlaceholderWidget({ content }: Props) {
  const { t } = useTranslation();
  const json = useMemo(() => {
    if (!content) return t("widget.placeholder.no_content");
    try {
      return JSON.stringify(content, null, 2).slice(0, 1000);
    } catch {
      return String(content).slice(0, 1000);
    }
  }, [content]);

  return (
    <BaseWidget>
      <div className="p-4 text-sm text-muted space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{'\u{1F4E6}'}</span>
          <span className="font-medium text-fg">{t("widget.placeholder.unrecognized")}</span>
        </div>
        <p className="text-xs text-muted">
          {t("widget.placeholder.description")}
        </p>
        <pre className="mt-2 p-2 rounded-lg bg-black/20 border border-white/5 text-[10px] text-muted/60 overflow-auto max-h-48 scrollbar-thin">
          {json}
        </pre>
      </div>
    </BaseWidget>
  );
}
