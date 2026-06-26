import type { ReactNode } from "react";
import type { ArtifactEvent } from "../../../lib/protocol";
import { BaseWidget } from "./BaseWidget";

interface Props {
  content?: unknown;
  onToast?: (msg: string, type: "ok" | "err" | "info" | "warn") => void;
  onBeep?: () => void;
  children?: ReactNode;
  renderData?: (data: unknown, isReal: boolean) => ReactNode;
}

export function parseContent(content: unknown): { data: unknown; title: string; isReal: boolean } {
  if (content && typeof content === "object" && "content" in (content as any)) {
    const event = content as ArtifactEvent;
    try {
      const parsed = JSON.parse(event.content);
      const items = parsed.items ?? [];
      const gameData = items[0]?.data ?? parsed;
      return { data: gameData, title: event.title || "", isReal: true };
    } catch {
      return { data: event.content, title: event.title || "", isReal: true };
    }
  }
  return { data: content, title: "", isReal: false };
}

export function DataWidget({ content, onToast, onBeep, children }: Props) {
  return (
    <BaseWidget content={content} onToast={onToast} onBeep={onBeep}>
      {children}
    </BaseWidget>
  );
}
