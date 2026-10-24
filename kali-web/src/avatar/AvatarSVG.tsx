/**
 * avatar/AvatarSVG.tsx — The multi-species mascot, driven by the avatar rig.
 *
 * The SVG is injected once (`avatarMarkup.ts`); nothing in React re-renders per frame. A
 * `PresenceFrame` from the core goes to an `AvatarRig`, which composes the expression layers,
 * smooths them with springs and paints through `SvgRenderer`. The same component runs in the
 * canvas, the Electron floating avatar and the native agent's WebView.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PerfProfileId } from "./avatarCatalog.gen";
import type { AvatarConfig } from "./avatarConfig";
import { applyAvatarConfig } from "./avatarConfigDom";
import { SVG_MARKUP } from "./avatarMarkup";
import { observeAvatarPrefs, readAvatarPrefs } from "./avatarPrefs";
import { SvgRenderer } from "./avatarRenderer";
import type { PresenceSnapshot } from "./presenceStore";
import { AvatarRig } from "./rig/rig";
import { RigLoop } from "./rig/loop";
import type { GazePoints } from "./rig/types";

interface Props {
  presence: PresenceSnapshot;
  config: AvatarConfig;
  /** Local audio analyser (canvas): drives the mouth with the real voice. */
  analyser?: AnalyserNode | null;
  /** Overrides the profile mirrored on <html> (tests, galleries). */
  perf?: PerfProfileId;
  reducedMotion?: boolean;
  /** Click or Enter/Space on the focused avatar. */
  onClick?: () => void;
  className?: string;
}

/** Voice band (300–3000 Hz) energy of an analyser, 0..1. */
export function analyserLevel(analyser: AnalyserNode): () => number {
  const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const lo = Math.max(1, Math.floor(300 / binHz));
  const hi = Math.min(data.length - 1, Math.ceil(3000 / binHz));
  return () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += data[i];
    return Math.min(1, (sum / ((hi - lo + 1) * 255)) * 2.2);
  };
}

export function AvatarSVG({ presence, config, analyser, perf, reducedMotion, onClick, className }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<AvatarRig | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const headRef = useRef<SVGGElement | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [announce, setAnnounce] = useState("");

  // Inject the SVG and start the rig once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = SVG_MARKUP;
    const svg = el.querySelector("#avatar-svg") as SVGSVGElement;
    svgRef.current = svg;
    headRef.current = svg.querySelector("#head-pivot") as SVGGElement;
    applyAvatarConfig(el, svg, headRef.current, configRef.current);
    const prefs = readAvatarPrefs();
    const rig = new AvatarRig({ renderer: new SvgRenderer(svg), now: Date.now(), perf: perf ?? prefs.perf, reduced: reducedMotion ?? prefs.reduced, species: configRef.current.species });
    rigRef.current = rig;
    svg.setAttribute("data-motion", (reducedMotion ?? prefs.reduced) || !rig.perf.breath ? "off" : "on");
    const loop = new RigLoop(rig);
    loop.start();
    const stopPrefs = observeAvatarPrefs((p) => {
      if (perf === undefined) rig.setPerf(p.perf);
      if (reducedMotion === undefined) rig.setReducedMotion(p.reduced);
      svg.setAttribute("data-motion", rig.isReduced || !rig.perf.breath ? "off" : "on");
    });
    return () => { stopPrefs(); loop.stop(); rigRef.current = null; el.innerHTML = ""; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = containerRef.current;
    if (el) applyAvatarConfig(el, svgRef.current, headRef.current, config);
    rigRef.current?.setSpecies(config.species);
  }, [config]);

  useEffect(() => { if (perf) rigRef.current?.setPerf(perf); }, [perf]);
  useEffect(() => { if (reducedMotion !== undefined) rigRef.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  useEffect(() => { rigRef.current?.setAnalyser(analyser ? analyserLevel(analyser) : null); }, [analyser]);

  // Feed the latest frame.
  useEffect(() => { rigRef.current?.setFrame(presence.frame, Date.now(), presence.offset); }, [presence]);

  // Gaze targets: pointer, text caret and thought cloud, coalesced to one update per animation frame.
  useEffect(() => {
    const points: GazePoints = {};
    let pending = 0;
    let rect: DOMRect | null = null;
    const norm = (x: number, y: number) => {
      rect = rect ?? svgRef.current?.getBoundingClientRect() ?? null;
      if (!rect || rect.width === 0) return null;
      const dx = ((x - rect.left) / rect.width - 0.5) * 2;
      const dy = ((y - rect.top) / rect.height - 0.5) * 2;
      const d = Math.hypot(dx, dy);
      return d > 1 ? { x: dx / d, y: dy / d } : { x: dx, y: dy };
    };
    const flush = () => { pending = 0; rigRef.current?.setGaze({ ...points }); };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(flush); };
    const onMove = (e: MouseEvent) => { points.cursor = norm(e.clientX, e.clientY); schedule(); };
    const onLeave = () => { points.cursor = null; schedule(); };
    const onCaret = (e: Event) => { const d = (e as CustomEvent<{ x: number; y: number }>).detail; if (d) { points.input = norm(d.x, d.y); schedule(); } };
    const onCloud = (e: Event) => { const d = (e as CustomEvent<{ x: number; y: number }>).detail; if (d) { points.thought = norm(d.x, d.y); schedule(); } };
    const onResize = () => { rect = null; };
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("kali:cursor-move", onCaret);
    window.addEventListener("kali:thought-cloud-move", onCloud);
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (containerRef.current) ro?.observe(containerRef.current);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("kali:cursor-move", onCaret);
      window.removeEventListener("kali:thought-cloud-move", onCloud);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      cancelAnimationFrame(pending);
    };
  }, []);

  const activity = presence.frame && presence.frame.connected ? presence.frame.activity.id : "offline";
  const tool = presence.frame?.activity.detail?.tool;

  // Only moments that need the user are announced (permission waits, going offline), not every face change.
  useEffect(() => {
    const key = activity === "esperando" ? "avatar.announce.waiting" : activity === "offline" ? "avatar.announce.offline" : "";
    const id = window.setTimeout(() => setAnnounce(key ? (t(key) as string) : ""), 1000);
    return () => clearTimeout(id);
  }, [activity, t]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); }
  }, [onClick]);

  const label = `${t("avatar.aria_label")}: ${t(`avatar.state.${activity}`)}${tool ? ` (${tool})` : ""}`;
  return (
    <div
      ref={containerRef}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={className}
      style={{ cursor: "pointer", userSelect: "none" }}
      aria-label={label}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      data-activity={activity}
    >
      <span aria-live="polite" className="sr-only">{announce}</span>
    </div>
  );
}
