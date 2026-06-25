import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactEvent } from "../../../lib/protocol";
import { BaseWidget } from "./BaseWidget";

interface Props {
  content?: unknown;
  onToast?: (msg: string, type: "ok" | "err" | "info" | "warn") => void;
  onBeep?: () => void;
  searchable?: boolean;
  onSearch?: (query: string) => void;
  autoScroll?: boolean;
  children?: ReactNode;
}

export function ScrollableWidget({ content, onToast, onBeep, searchable, onSearch: onSearchProp, autoScroll, children }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const event = content as ArtifactEvent | undefined;
  const isStreaming = event?.phase === "streaming";

  // Auto-scroll to bottom when content changes during streaming.
  useEffect(() => {
    if (autoScroll && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [children, autoScroll, isStreaming]);

  const onSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    onSearchProp?.(q);
  }, [onSearchProp]);

  return (
    <BaseWidget content={content} onToast={onToast} onBeep={onBeep}>
      {searchable && (
        <div className="px-3 pt-2 pb-1 shrink-0">
          <input
            type="text"
            value={query}
            onChange={onSearchChange}
            placeholder={t("widget.scrollable.search")}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder:text-muted outline-none focus:border-accent/40 transition"
          />
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {children}
      </div>
    </BaseWidget>
  );
}
