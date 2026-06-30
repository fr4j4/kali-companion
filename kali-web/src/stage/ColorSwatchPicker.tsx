/**
 * stage/ColorSwatchPicker.tsx — Custom color picker popover with Portal.
 *
 * Fixed to prevent clipping by parent overflow: auto containers.
 * Uses React Portal to render at the body root and calculates position
 * dynamically relative to the trigger swatch.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(normalizeHex(value));
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, flipUp: false });
  
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const rgb = useMemo(() => hexToRgb(value), [value]);
  const hsl = useMemo(() => rgbToHsl(rgb.r, rgb.g, rgb.b), [rgb]);

  useEffect(() => {
    setHexInput(normalizeHex(value));
  }, [value]);

  const updatePosition = useCallback(() => {
    if (!swatchRef.current) return;
    const rect = swatchRef.current.getBoundingClientRect();
    const POPOVER_HEIGHT = 320;
    const POPOVER_WIDTH = 230;
    
    let flipUp = window.innerHeight - rect.bottom < POPOVER_HEIGHT + 20;
    
    // Anchor to the RIGHT of the swatch if possible, or LEFT
    let left = rect.right - POPOVER_WIDTH;
    
    // Clamp to screen edges
    const margin = 16;
    if (left < margin) left = margin;
    if (left + POPOVER_WIDTH > window.innerWidth - margin) {
      left = window.innerWidth - POPOVER_WIDTH - margin;
    }

    setPopoverPos({
      top: flipUp ? rect.top - 8 : rect.bottom + 8,
      left,
      flipUp
    });
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        swatchRef.current && !swatchRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    const onScroll = () => {
      // Re-position on scroll or just close it to avoid detachment
      // For Portals, closing is often safer unless we use a robust floating library
      handleClose();
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", handleClose);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open, handleClose]);

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
    <div className="cust-picker-wrap csp-wrap">
      <div className="cust-picker-label">{label}</div>
      <button
        ref={swatchRef}
        type="button"
        className="csp-swatch"
        style={{ background: value }}
        onClick={handleToggle}
        aria-label={label}
        title={label}
      />
      
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popoverRef}
              className={`csp-popover portal-popover ${popoverPos.flipUp ? "csp-flip-up" : ""}`}
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                zIndex: 9999,
                pointerEvents: "auto"
              }}
              initial={{ opacity: 0, scale: 0.95, y: popoverPos.flipUp ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: popoverPos.flipUp ? 4 : -4 }}
              transition={{ duration: 0.12 }}
              role="dialog"
              aria-label={label}
              onMouseDown={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
              <div className="csp-section-label">{t("colorSwatchPicker.presets")}</div>
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
                <label className="csp-section-label">{t("colorSwatchPicker.hex")}</label>
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
                {t("colorSwatchPicker.exploreColors")}
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
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
