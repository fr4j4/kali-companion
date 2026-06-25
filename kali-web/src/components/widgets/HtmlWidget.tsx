import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { injectHashGuard } from "../artifacts/htmlUtils";

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
      <div className="flex flex-1 flex-col min-h-0">
        <iframe
          srcDoc={injectHashGuard(html)}
          sandbox="allow-scripts allow-popups allow-forms"
          className="w-full flex-1 min-h-0 border-none bg-white"
          title={t("widget.html.title")}
        />
      </div>
    </BaseWidget>
  );
}