import { useLayoutEffect, useState, useSyncExternalStore } from "react";

export interface GameViewport {
  /** Logical width of the game content area. */
  width: number;
  /** Logical height of the game content area. */
  height: number;
  /** Pixel ratio of the host display. */
  dpr: number;
  /** Whether the parent window is maximized. */
  isMaximized: boolean;
  /** True until the container has been measured at least once. */
  ready: boolean;
}

function subscribeMaximized(
  container: HTMLElement,
  callback: (isMaximized: boolean) => void,
): () => void {
  let last = container.closest(".kw.maximized") != null;
  callback(last);

  const observer = new MutationObserver(() => {
    const next = container.closest(".kw.maximized") != null;
    if (next !== last) {
      last = next;
      callback(next);
    }
  });
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: false,
    childList: false,
  });
  const parent = container.parentElement;
  if (parent) {
    observer.observe(parent, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: false,
      childList: false,
    });
  }
  return () => observer.disconnect();
}

/**
 * Track the viewport of a game renderer.
 *
 * - In normal windowed mode: returns the actual size of the container.
 * - In maximized mode: returns the full available area for letterboxing.
 *
 * The renderer is expected to scale its intrinsic content to fit this viewport
 * while preserving its declared aspect ratio.
 */
export function useGameViewport(
  containerRef: React.RefObject<HTMLElement | null>,
  isMaximizedProp?: boolean,
): GameViewport {
  const [viewport, setViewport] = useState<GameViewport>({
    width: 0,
    height: 0,
    dpr: 1,
    isMaximized: false,
    ready: false,
  });

  const isMaximized = useSyncExternalStore(
    (callback) => {
      const el = containerRef.current;
      if (!el) return () => {};
      return subscribeMaximized(el, () => callback());
    },
    () => (isMaximizedProp ? "true" : "false"),
  ) === "true";

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const max = isMaximizedProp ?? (el.closest(".kw.maximized") != null);
      setViewport({
        width: rect.width,
        height: rect.height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        isMaximized: max,
        ready: rect.width > 0 && rect.height > 0,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerRef, isMaximizedProp, isMaximized]);

  return viewport;
}

/**
 * Compute the uniform scale needed to fit a rectangle of (naturalWidth, naturalHeight)
 * into (containerWidth, containerHeight) while preserving aspect ratio.
 */
export function fitScale(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return 0;
  }
  return Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
}

/**
 * Center offsets for letterbox/pillarbox given a uniform scale.
 */
export function centerOffsets(
  naturalWidth: number,
  naturalHeight: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  if (scale <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, (containerWidth - naturalWidth * scale) / 2),
    y: Math.max(0, (containerHeight - naturalHeight * scale) / 2),
  };
}
