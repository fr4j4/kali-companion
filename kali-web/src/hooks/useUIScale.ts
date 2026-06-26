import { useCallback, useEffect, useState } from "react";

export interface UIScale {
  global: number;
  text: number;
  avatar: number;
  window: number;
  density: number;
}

const STORAGE_KEY = "kali.uiScale";
const DEFAULTS: UIScale = { global: 1, text: 1, avatar: 1, window: 1, density: 1 };

function loadScale(): UIScale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch { /* ignore */ }
  return DEFAULTS;
}

function applyScaleVars(scale: UIScale) {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(scale.global));
  root.style.setProperty("--ui-scale-text", String(scale.text));
  root.style.setProperty("--ui-scale-avatar", String(scale.avatar));
  root.style.setProperty("--ui-scale-window", String(scale.window));
  root.style.setProperty("--ui-scale-density", String(scale.density));
}

export function useUIScale() {
  const [scale, setScaleState] = useState<UIScale>(loadScale);

  useEffect(() => {
    applyScaleVars(scale);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scale));
  }, [scale]);

  const setScale = useCallback((patch: Partial<UIScale>) => {
    setScaleState((prev) => {
      const next = { ...prev, ...patch };
      // Clamp values between 0.5 and 2
      for (const key of Object.keys(next) as (keyof UIScale)[]) {
        next[key] = Math.max(0.5, Math.min(2, next[key]));
      }
      return next;
    });
  }, []);

  const resetScale = useCallback(() => {
    setScaleState(DEFAULTS);
  }, []);

  return { scale, setScale, resetScale };
}
