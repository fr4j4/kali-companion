import { useTranslation } from "react-i18next";
import { GameResourceCard } from "./GameResourceCard";

interface WidgetItem {
  title: string;
  description: string;
  status: "success" | "error" | "info";
  details?: string[];
  widgetType?: string;
  data?: Record<string, unknown>;
}

interface Props {
  content: string;
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}

export function WidgetGrid({ content, imageReadyKeys, onRequestImage }: Props) {
  const { t } = useTranslation();
  let items: WidgetItem[];
  try {
    const parsed = JSON.parse(content);
    items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  } catch {
    items = [];
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-muted">
        <p>{t("canvas.widget.empty")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((item, idx) => {
        const stableKey = item.data
          ? `gr_${(item.data as Record<string, unknown>).title ?? idx}`
          : `w_${idx}`;
        if (item.widgetType === "game_resource" && item.data) {
          return <GameResourceCard key={stableKey} data={item.data} imageReadyKeys={imageReadyKeys} onRequestImage={onRequestImage} />;
        }
        return (
          <div
            key={stableKey}
            className={`rounded-lg border p-3 text-sm ${
              item.status === "success"
                ? "border-ok/30 bg-ok/10"
                : item.status === "error"
                  ? "border-err/30 bg-err/10"
                  : "border-border bg-elevated"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  item.status === "success"
                    ? "bg-ok"
                    : item.status === "error"
                      ? "bg-err"
                      : "bg-accent"
                }`}
              />
              <span className="font-medium text-foreground">{item.title}</span>
            </div>
            <p className="text-muted ml-4">{item.description}</p>
            {item.details && item.details.length > 0 && (
              <ul className="mt-2 ml-4 space-y-0.5">
                {item.details.map((d, i) => (
                  <li key={i} className="text-muted text-xs list-disc list-inside">
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
