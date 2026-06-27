import React from "react";
import type { ArtifactWindowData } from "../workspace/types";
import type { ArtifactEvent } from "../lib/protocol";
import { widgetRegistry } from "../components/widgets/widgetRegistry";

interface Props {
  window: ArtifactWindowData;
  onHeaderActions?: (actions: React.ReactNode) => void;
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
function extractVariant(w: ArtifactWindowData): string | undefined {
  const content = w.content as ArtifactEvent | null;
  if (!content || content.content == null) return undefined;
  try {
    const parsed = JSON.parse(content.content);
    const items = parsed.items ?? [];
    const data = items[0]?.data ?? parsed;
    if (data && typeof data === "object" && "type" in data) {
      return String((data as Record<string, unknown>).type);
    }
  } catch {
    // content is not JSON — fall through
  }
  if (content.type === "markdown") return "markdown";
  return undefined;
}

export function WindowContentRouter({ window: w }: Props) {
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
  const variant = extractVariant(w);

  return (
    <React.Suspense fallback={<LoadingPlaceholder />}>
      <Component content={w.content} variant={variant} />
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
