import { useEffect, useState } from "react";
import { StageProvider } from "./stage/StageProvider";
import { NeuralCanvas } from "./stage/NeuralCanvas";
import { useUIScale } from "./hooks/useUIScale";

export type PerformanceProfile = "balanced" | "performance" | "quality";

const PERFORMANCE_PROFILES: PerformanceProfile[] = ["balanced", "performance", "quality"];

function shouldUseLowPerfProfile(): boolean {
  const stored = localStorage.getItem("kali.perfLow");
  if (stored === "0") return false;
  if (stored === "1") return true;
  const ua = navigator.userAgent;
  const isWebkitGtk = /webkit/i.test(ua) && !/chrome|chromium|edge|firefox/i.test(ua);
  const cores = navigator.hardwareConcurrency || 8;
  return isWebkitGtk || cores <= 4;
}

/**
 * Detect low-performance environments and mark <html> with `kali-perf-low`.
 *
 * This disables GPU-expensive effects (backdrop-filter, infinite SVG
 * animations, drop-shadow on tethers) via CSS (see styles.css). The flag
 * is applied when:
 *   - the UA reports WebKitGTK (Tauri's webview on Linux), whose JIT and
 *     software compositor are noticeably slower than Chrome, or
 *   - the device has 4 or fewer logical cores, or
 *   - the user opts in via localStorage `kali.perfLow = "1"`.
 *
 * The check runs once at startup; it never flips back automatically to
 * avoid visual thrash. Users can force the high-perf path by setting
 * `kali.perfLow = "0"`.
 */
function usePerfProfile() {
  useEffect(() => {
    const stored = localStorage.getItem("kali.perfLow");
    if (stored === "0") {
      document.documentElement.classList.remove("kali-perf-low");
      return;
    }
    if (stored === "1") {
      document.documentElement.classList.add("kali-perf-low");
      return;
    }
    if (shouldUseLowPerfProfile()) {
      document.documentElement.classList.add("kali-perf-low");
    }
  }, []);
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("kali.theme");
    if (saved && ["amberwave", "foxglove", "vellum", "tidepool", "aether"].includes(saved)) return saved;
    if (saved && ["synthwave", "midnight", "sunset", "forest"].includes(saved)) {
      localStorage.setItem("kali.theme", "amberwave");
      return "amberwave";
    }
    return "amberwave";
  });
  const [performanceProfile, setPerformanceProfile] = useState<PerformanceProfile>(() => {
    const saved = localStorage.getItem("kali.performanceProfile");
    return PERFORMANCE_PROFILES.includes(saved as PerformanceProfile)
      ? (saved as PerformanceProfile)
      : "balanced";
  });
  const [canvasAutoExpand, setCanvasAutoExpand] = useState(
    () => localStorage.getItem("kali.canvasAutoExpand") !== "false",
  );
  const { scale, setScale } = useUIScale();
  usePerfProfile();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kali.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-perf-profile", performanceProfile);
    if (performanceProfile === "performance") {
      document.documentElement.classList.add("kali-perf-low");
    } else if (performanceProfile === "quality") {
      document.documentElement.classList.remove("kali-perf-low");
    } else {
      document.documentElement.classList.toggle("kali-perf-low", shouldUseLowPerfProfile());
    }
    localStorage.setItem("kali.performanceProfile", performanceProfile);
  }, [performanceProfile]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }
  }, [theme]);

  return (
    <StageProvider>
      <NeuralCanvas
        theme={theme}
        onThemeChange={setTheme}
        performanceProfile={performanceProfile}
        onPerformanceProfileChange={setPerformanceProfile}
        canvasAutoExpand={canvasAutoExpand}
        onCanvasAutoExpandChange={(v) => {
          setCanvasAutoExpand(v);
          localStorage.setItem("kali.canvasAutoExpand", String(v));
        }}
        uiScale={scale}
        onUIScaleChange={setScale}
      />
    </StageProvider>
  );
}
