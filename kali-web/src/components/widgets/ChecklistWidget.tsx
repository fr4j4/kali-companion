/**
 * ChecklistWidget — steps to tick off: progress in words and a thin bar, round checks, done steps
 * fade and strike through, and a field at the end to add one more.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { CHECKLIST_ITEMS } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Item {
  text: string;
  done: boolean;
  note?: string;
}

interface Props {
  content?: unknown;
}

export function ChecklistWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const real = Array.isArray(d.items);
  const initial = useMemo(() => (real ? (d.items as Item[]) : CHECKLIST_ITEMS), [d, real]) as Item[];

  const [items, setItems] = useState<Item[]>(initial);
  useEffect(() => setItems(initial), [initial]);
  const [newText, setNewText] = useState("");

  const toggle = useCallback((idx: number) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, done: !item.done } : item)));
  }, []);

  const addItem = useCallback(() => {
    const txt = newText.trim();
    if (!txt) return;
    setItems((prev) => [...prev, { text: txt, done: false }]);
    setNewText("");
  }, [newText]);

  const doneCount = items.filter((i) => i.done).length;
  const progress = items.length > 0 ? (doneCount / items.length) * 100 : 0;
  const label = t("widget.checklist.completed", { done: doneCount, total: items.length });

  useShellSubtitle(label);
  useShellSample(!isReal || !real);

  return (
    <BaseWidget>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="checklist" />
      ) : (
        <div className="kw-check scrollbar-thin">
          <div className="kw-check-progress">
            <div className="kw-break-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
              <div style={{ width: `${progress}%` }} />
            </div>
          </div>
          <ul className="kw-check-list">
            {items.map((item, i) => (
              <li key={i}>
                <button type="button" role="checkbox" aria-checked={item.done} className={`kw-check-item ${item.done ? "is-done" : ""}`} onClick={() => toggle(i)}>
                  <span className="kw-check-box">{item.done && <Check size={12} strokeWidth={3} aria-hidden="true" />}</span>
                  <span className="kw-check-text">
                    {item.text}
                    {item.note && <span className="kw-check-note">{item.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form className="kw-check-add" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
            <Plus size={14} aria-hidden="true" />
            <input type="text" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder={t("widget.checklist.new_task") as string} aria-label={t("widget.checklist.new_task") as string} />
          </form>
        </div>
      )}
      <WidgetFooter>
        <span className="v2-foot-item">{label}</span>
      </WidgetFooter>
    </BaseWidget>
  );
}
