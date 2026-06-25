import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { CHECKLIST_ITEMS } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Item {
  text: string;
  done: boolean;
}

interface Props {
  content?: unknown;
}

export function ChecklistWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const initial = useMemo(() => {
    if (d.items && Array.isArray(d.items)) return d.items as Item[];
    return CHECKLIST_ITEMS;
  }, [d]) as Item[];

  const [items, setItems] = useState<Item[]>(initial);
  const [newText, setNewText] = useState("");

  const toggle = useCallback((idx: number) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, done: !item.done } : item));
  }, []);

  const addItem = useCallback(() => {
    const txt = newText.trim();
    if (!txt) return;
    setItems((prev) => [...prev, { text: txt, done: false }]);
    setNewText("");
  }, [newText]);

  const doneCount = items.filter((i) => i.done).length;
  const progress = items.length > 0 ? (doneCount / items.length) * 100 : 0;

  return (
    <BaseWidget>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="checklist" />
      ) : (
        <div className="p-3 space-y-2">
          {/* Progress bar */}
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-muted">{t("widget.checklist.completed", { done: doneCount, total: items.length })}</div>

          {/* Items */}
          <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-thin">
            {items.map((item, i) => (
              <div
                key={i}
                onClick={() => toggle(i)}
                className={`check-item flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.03] ${item.done ? "done" : ""}`}
              >
                <div className={`check-box w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${item.done ? "bg-accent border-accent" : "border-white/20"}`}>
                  {item.done && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                </div>
                <span className="check-label text-xs text-fg">{item.text}</span>
              </div>
            ))}
          </div>

          {/* New item input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder={t("widget.checklist.new_task")}
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-fg placeholder:text-muted outline-none focus:border-accent/40 transition"
            />
            <button
              onClick={addItem}
              className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs hover:brightness-110 transition"
            >
              +
            </button>
          </div>
        </div>
      )}
    </BaseWidget>
  );
}
