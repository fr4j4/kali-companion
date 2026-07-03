import React, { memo, useMemo } from "react";
import type { WindowData, WorkspaceAPI } from "../workspace/types";
import type { ArtifactEvent } from "../lib/protocol";
import { widgetRegistry } from "../components/widgets/widgetRegistry";

interface Props {
  window: WindowData;
  onHeaderActions?: (actions: React.ReactNode) => void;
  api?: WorkspaceAPI;
}

/**
 * Extract a `variant` string from the artifact content for widgets
 * that support multiple render modes (MediaWidget: audio|video,
 * DocumentWidget: markdown|prose|transcript).
 *
 * Priority:
 *  1. data.type field inside the parsed content (e.g. "video", "transcript")
 *  2. artifact event type (e.g. "markdown" → "markdown")
 *  3. undefined (widget uses its own default)
 */
function extractVariant(content: unknown): string | undefined {
  const ev = content as ArtifactEvent | null;
  if (!ev || ev.content == null) return undefined;
  try {
    const parsed = JSON.parse(ev.content);
    const items = parsed.items ?? [];
    const data = items[0]?.data ?? parsed;
    if (data && typeof data === "object" && "type" in data) {
      return String((data as Record<string, unknown>).type);
    }
  } catch {
    // content is not JSON — fall through
  }
  if (ev.type === "markdown") return "markdown";
  return undefined;
}

function WindowContentRouterImpl({ window: w, api }: Props) {
  // All hooks must be called before any early return — React requires
  // hooks to be called in the same order on every render.
  const variant = useMemo(() => extractVariant(w.content), [w.content]);

  // Content not yet loaded (closed artifact reopened, or reattach of an open
  // artifact whose content is fetched on demand). Only applies to backend
  // artifacts (those with an artifactId); local windows like "reasoning"
  // carry no content prop and read their data from chat state directly.
  if (w.content == null && w.artifactId != null) {
    return <LoadingPlaceholder />;
  }

  const entry = widgetRegistry[w.type];

  if (!entry) {
    const Placeholder = React.lazy(() => import("../components/widgets/PlaceholderWidget").then((m) => ({ default: m.PlaceholderWidget })));
    return (
      <React.Suspense fallback={<LoadingPlaceholder />}>
        <Placeholder content={w.content} />
      </React.Suspense>
    );
  }

  const Component = entry.component;

  return (
    <React.Suspense fallback={<LoadingPlaceholder />}>
      <Component content={w.content} variant={variant} api={api} windowId={w.id} />
    </React.Suspense>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Memoized so that when a parent (KaliWindow) re-renders due to
 * position/size changes (e.g. during drag), the widget content itself
 * doesn't re-render unless its `window.content` or `api` reference changed.
 */
export const WindowContentRouter = memo(WindowContentRouterImpl, (prev, next) => {
  if (prev.window.content !== next.window.content) return false;
  if (prev.window.type !== next.window.type) return false;
  if (prev.window.id !== next.window.id) return false;
  if (prev.api !== next.api) return false;
  return true;
});