import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function HtmlWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const html = useMemo(() => {
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "content" in (data as Record<string, unknown>)) {
      return String((data as Record<string, unknown>).content);
    }
    return "";
  }, [data]);

  return (
    <BaseWidget>
      <div className="flex-1 overflow-auto scrollbar-thin">
        <iframe
          srcDoc={html}
          sandbox="allow-scripts allow-popups allow-forms"
          className="w-full h-full border-none bg-white"
          style={{ minHeight: "300px" }}
          title={t("widget.html.title")}
        />
      </div>
    </BaseWidget>
  );
}