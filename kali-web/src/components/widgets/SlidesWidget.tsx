/**
 * SlidesWidget — a deck: thumbnails on the left, the chosen 16:9 slide, the speaker notes under
 * it, and "Presentar" for full screen (arrows move, Esc leaves). Every slide is laid out once at
 * 960×540 and scaled, so a thumbnail is the same slide, smaller. The content is
 * `{ slides: [{ title, kicker?, body?, points?: [{ title, text }], source?, notes? }], proposal? }`.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, MessageSquare, Play, X } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useStage } from "../../stage/StageProvider";

export interface SlidePoint { title: string; text?: string }
export interface Slide { title: string; kicker?: string; body?: string; points?: SlidePoint[]; source?: string; notes?: string }

const BASE_W = 960;
const BASE_H = 540;

const SAMPLE: { slides: Slide[]; proposal: string } = {
  proposal: "Kali propone acortar esta diapositiva",
  slides: [
    { kicker: "Taller Lupa", title: "Plan de servicio 2027", body: "Qué revisamos, cada cuánto y por qué." },
    { kicker: "Taller Lupa · Diagnóstico", title: "La mayoría llega tarde a la revisión", body: "Siete de cada diez relojes llegan con más de seis años sin servicio." },
    {
      kicker: "Taller Lupa · Servicio", title: "Revisar cada cinco años evita reparaciones grandes",
      points: [
        { title: "Limpieza", text: "Se retira el polvo y el aceite viejo antes de que dañen piezas." },
        { title: "Lubricación", text: "Una gota por rubí, sin exceder la cavidad." },
        { title: "Regulación", text: "Se ajusta la marcha en banco hasta quedar estable." },
      ],
      source: "Fuente: manual del fabricante, 2023",
      notes: "Empezar con la pregunta: ¿cuándo fue la última vez que revisaste tu reloj? Dejar que respondan antes de pasar a las tres tarjetas.",
    },
    { kicker: "Taller Lupa · Precios", title: "Un precio cerrado por servicio", body: "Limpieza, lubricación y regulación en un solo valor." },
    { kicker: "Taller Lupa", title: "Reserva en línea", body: "taller-lupa.cl/reservas" },
  ],
};

function readSlides(data: unknown): { slides: Slide[]; proposal: string } | null {
  const d = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.slides)) return null;
  const slides = (d.slides as unknown[]).filter((s): s is Slide => !!s && typeof s === "object" && typeof (s as Slide).title === "string");
  return { slides, proposal: typeof d.proposal === "string" ? d.proposal : "" };
}

/** One slide at its base size; the parent scales it. */
function SlideFace({ slide, index }: { slide: Slide; index: number }) {
  const points = (slide.points ?? []).filter((p) => p && typeof p.title === "string").slice(0, 4);
  return (
    <div className="kw-slide-face">
      {slide.kicker && <div className="kw-slide-kicker">{slide.kicker}</div>}
      <h2 className="kw-slide-title">{slide.title}</h2>
      {slide.body && <p className="kw-slide-body">{slide.body}</p>}
      {points.length > 0 && (
        <div className="kw-slide-points" style={{ gridTemplateColumns: `repeat(${points.length}, 1fr)` }}>
          {points.map((p, i) => (
            <div key={i} className="kw-slide-point"><strong>{p.title}</strong>{p.text && <span>{p.text}</span>}</div>
          ))}
        </div>
      )}
      <div className="kw-slide-foot"><span>{slide.source ?? ""}</span><span>{index + 1}</span></div>
    </div>
  );
}

/** A slide scaled to the width of its box. */
function ScaledSlide({ slide, index, width }: { slide: Slide; index: number; width: number }) {
  const s = width / BASE_W;
  return (
    <div className="kw-slide-box" style={{ width, height: BASE_H * s }}>
      <div className="kw-slide-scale" style={{ width: BASE_W, height: BASE_H, transform: `scale(${s})` } as CSSProperties}>
        <SlideFace slide={slide} index={index} />
      </div>
    </div>
  );
}

function useBoxWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Presenter({ slides, index, onIndex, onClose }: { slides: Slide[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.requestFullscreen?.().catch(() => {});
    const onResize = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);
  const width = Math.min(vw.w - 48, ((vw.h - 48) * BASE_W) / BASE_H);
  return createPortal(
    <div
      ref={ref}
      className="kw-presenter"
      role="dialog"
      aria-modal="true"
      aria-label={t("v2.slides.presenting") as string}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); onIndex(Math.min(slides.length - 1, index + 1)); }
        else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); onIndex(Math.max(0, index - 1)); }
      }}
      onClick={() => onIndex(Math.min(slides.length - 1, index + 1))}
    >
      <ScaledSlide slide={slides[index]} index={index} width={width} />
      <button type="button" className="v2-icon-btn kw-presenter-close" aria-label={t("v2.slides.stop") as string} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}

export function SlidesWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { compact } = useShell();
  const { data, title, isReal } = useMemo(() => parseContent(content), [content]);
  const real = useMemo(() => (isReal ? readSlides(data) : null), [data, isReal]);
  const deck = real ?? SAMPLE;
  const slides = deck.slides;
  const [cur, setCur] = useState(real ? 0 : 2);
  const i = Math.min(cur, Math.max(0, slides.length - 1));
  const slide = slides[i];
  const [presenting, setPresenting] = useState(false);
  const [asked, setAsked] = useState(false);
  const [stageRef, stage] = useBoxWidth<HTMLDivElement>();
  const railRef = useRef<HTMLDivElement>(null);

  // The deck's own name when it differs from the window title; otherwise the type.
  useShellSubtitle(slides[0] && slides[0].title !== title ? slides[0].title : null);
  useShellSample(!real);

  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-slide="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const go = useCallback((n: number) => setCur(Math.max(0, Math.min(slides.length - 1, n))), [slides.length]);
  const stop = useCallback(() => setPresenting(false), []);
  const minutes = Math.max(1, Math.round(slides.length * 0.7));

  if (!slide) {
    return <BaseWidget><div className="kw-empty-state">{t("v2.slides.empty")}</div></BaseWidget>;
  }

  const stageW = Math.max(160, Math.min(stage.w - 32, ((stage.h - 32) * BASE_W) / BASE_H));

  return (
    <BaseWidget>
      <div
        className="kw-slides"
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea")) return;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
        }}
      >
        {!compact && (
          <div className="kw-slides-bar">
            <button type="button" className="v2-btn is-primary" onClick={() => setPresenting(true)}><Play size={14} aria-hidden="true" />{t("v2.slides.present")}</button>
            <div className="kw-slides-nav">
              <button type="button" className="v2-icon-btn sm" aria-label={t("v2.slides.prev") as string} disabled={i === 0} onClick={() => go(i - 1)}><ChevronLeft size={14} aria-hidden="true" /></button>
              <span className="kw-mono">{i + 1} / {slides.length}</span>
              <button type="button" className="v2-icon-btn sm" aria-label={t("v2.slides.next") as string} disabled={i === slides.length - 1} onClick={() => go(i + 1)}><ChevronRight size={14} aria-hidden="true" /></button>
            </div>
            {deck.proposal && isReal && (
              <button
                type="button"
                className="kw-slides-proposal"
                disabled={asked}
                onClick={() => { chat.send(t("v2.slides.proposal_msg", { n: i + 1, proposal: deck.proposal })); setAsked(true); }}
              >
                <MessageSquare size={13} aria-hidden="true" />{asked ? t("v2.slides.proposal_sent") : deck.proposal}
              </button>
            )}
          </div>
        )}
        <div className="kw-slides-main">
          {!compact && (
            <nav ref={railRef} className="kw-slides-rail scrollbar-thin" aria-label={t("v2.slides.rail") as string}>
              {slides.map((s, n) => (
                <button key={n} type="button" data-slide={n} className="kw-slides-thumb" aria-current={n === i || undefined} aria-label={t("v2.slides.go", { n: n + 1, title: s.title }) as string} onClick={() => go(n)}>
                  <ScaledSlide slide={s} index={n} width={96} />
                  <span className="kw-mono">{n + 1}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="kw-slides-center">
            <div ref={stageRef} className="kw-slides-stage" tabIndex={0} aria-label={t("v2.slides.slide_n", { n: i + 1, total: slides.length }) as string}>
              <ScaledSlide slide={slide} index={i} width={stageW} />
            </div>
            {!compact && slide.notes && (
              <section className="kw-slides-notes" aria-label={t("v2.slides.notes") as string}>
                <h3 className="kw-side-title is-inline">{t("v2.slides.notes")}</h3>
                <p>{slide.notes}</p>
              </section>
            )}
          </div>
        </div>
      </div>
      {presenting && <Presenter slides={slides} index={i} onIndex={go} onClose={stop} />}
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.slides.slide_n", { n: i + 1, total: slides.length })}</span>
        <span className="v2-foot-item">{t("v2.slides.minutes", { count: minutes })}</span>
      </WidgetFooter>
    </BaseWidget>
  );
}
