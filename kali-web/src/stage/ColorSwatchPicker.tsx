/**
 * stage/ColorSwatchPicker.tsx — Custom color picker popover.
 *
 * Replaces the native <input type="color"> to avoid the Chrome picker
 * popup going off-screen when the trigger is at the right edge of the
 * viewport. The popover is anchored to the LEFT of the swatch and
 * contains: preset palette, HEX input, HSL sliders, and a native
 * fallback trigger for full color exploration.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

const PRESETS: string[] = [
  "#000000", "#1F2937", "#4B5563", "#9CA3AF", "#D1D5DB", "#FFFFFF",
  "#7F1D1D", "#DC2626", "#F87171", "#FCA5A5", "#FECACA", "#FEE2E2",
  "#7C2D12", "#EA580C", "#F97316", "#FB923C", "#FDBA74", "#FED7AA",
  "#713F12", "#CA8A04", "#EAB308", "#FACC15", "#FDE047", "#FEF08A",
  "#14532D", "#15803D", "#22C55E", "#4ADE80", "#86EFAC", "#BBF7D0",
  "#1E3A8A", "#1D4ED8", "#3B82F6", "#60A5FA", "#93C5FD", "#DBEAFE",
  "#581C87", "#7C3AED", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE",
  "#831843", "#BE185D", "#EC4899", "#F472B6", "#F9A8D4", "#FBCFE8",
];

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isValidHex(s: string): boolean {
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s);
}

function normalizeHex(s: string): string {
  let h = s.trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length === 4) {
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return ("#" + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

export function ColorSwatchPicker({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(normalizeHex(value));
  const [flipUp, setFlipUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const rgb = useMemo(() => hexToRgb(value), [value]);
  const hsl = useMemo(() => rgbToHsl(rgb.r, rgb.g, rgb.b), [rgb]);

  useEffect(() => {
    setHexInput(normalizeHex(value));
  }, [value]);

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, handleClose]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect();
        const drawerBody = wrapRef.current.closest(".cust-body") as HTMLElement | null;
        if (drawerBody) {
          const bodyRect = drawerBody.getBoundingClientRect();
          const spaceBelow = bodyRect.bottom - rect.bottom;
          setFlipUp(spaceBelow < 280);
        } else {
          setFlipUp(window.innerHeight - rect.bottom < 280);
        }
      }
      return next;
    });
  }, []);

  const handlePreset = useCallback((c: string) => {
    onChange(c);
    setHexInput(c);
  }, [onChange]);

  const handleHexChange = useCallback((s: string) => {
    setHexInput(s);
    if (isValidHex(s)) {
      onChange(normalizeHex(s));
    }
  }, [onChange]);

  const handleHexBlur = useCallback(() => {
    if (isValidHex(hexInput)) {
      const norm = normalizeHex(hexInput);
      setHexInput(norm);
      onChange(norm);
    } else {
      setHexInput(normalizeHex(value));
    }
  }, [hexInput, value, onChange]);

  const handleSlider = useCallback((channel: "h" | "s" | "l", v: number) => {
    const nh = channel === "h" ? v : hsl.h;
    const ns = channel === "s" ? v : hsl.s;
    const nl = channel === "l" ? v : hsl.l;
    const newRgb = hslToRgb(nh, ns, nl);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    onChange(hex);
    setHexInput(hex);
  }, [hsl, onChange]);

  const openNative = useCallback(() => {
    nativeInputRef.current?.click();
  }, []);

  const handleNativeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value.toUpperCase());
  }, [onChange]);

  return (
    <div className="cust-picker-wrap csp-wrap" ref={wrapRef}>
      <button
        type="button"
        className="csp-swatch"
        style={{ background: value }}
        onClick={handleToggle}
        aria-label={label}
        title={label}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className={`csp-popover ${flipUp ? "csp-flip-up" : ""}`}
            initial={{ opacity: 0, scale: 0.95, y: flipUp ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: flipUp ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            role="dialog"
            aria-label={label}
          >
            <div className="csp-section-label">Presets</div>
            <div className="csp-presets">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`csp-preset ${normalizeHex(value) === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => handlePreset(c)}
                  aria-label={c}
                />
              ))}
            </div>

            <div className="csp-divider" />

            <div className="csp-hex-row">
              <label className="csp-section-label">HEX</label>
              <input
                type="text"
                className="csp-hex-input"
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                onBlur={handleHexBlur}
                maxLength={7}
                spellCheck={false}
              />
            </div>

            <div className="csp-divider" />

            <div className="csp-preview" style={{ background: value }} />

            <div className="csp-sliders">
              <div className="csp-slider-row">
                <span className="csp-slider-label">H</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={Math.round(hsl.h)}
                  onChange={(e) => handleSlider("h", Number(e.target.value))}
                  className="csp-slider csp-slider-h"
                />
                <span className="csp-slider-value">{Math.round(hsl.h)}°</span>
              </div>
              <div className="csp-slider-row">
                <span className="csp-slider-label">S</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(hsl.s)}
                  onChange={(e) => handleSlider("s", Number(e.target.value))}
                  className="csp-slider"
                />
                <span className="csp-slider-value">{Math.round(hsl.s)}%</span>
              </div>
              <div className="csp-slider-row">
                <span className="csp-slider-label">L</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(hsl.l)}
                  onChange={(e) => handleSlider("l", Number(e.target.value))}
                  className="csp-slider"
                />
                <span className="csp-slider-value">{Math.round(hsl.l)}%</span>
              </div>
            </div>

            <div className="csp-divider" />

            <button type="button" className="csp-native-trigger" onClick={openNative}>
              Explorar colores
            </button>
            <input
              ref={nativeInputRef}
              type="color"
              value={normalizeHex(value)}
              onChange={handleNativeChange}
              className="csp-native-input"
              tabIndex={-1}
              aria-hidden="true"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
