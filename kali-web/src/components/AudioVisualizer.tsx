// AudioVisualizer — canvas frequency bars while TTS plays.

import { useEffect, useRef } from "react";

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
}

export function AudioVisualizer({ analyser, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        const dpr = window.devicePixelRatio;
        canvas.width = containerWidth * dpr;
        canvas.height = 32 * dpr;
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!analyser || !active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bars = 32;
      const step = Math.floor(data.length / bars);
      const barW = w / bars;
      const dpr = window.devicePixelRatio;
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        const barH = v * h * 0.9;
        ctx.fillStyle = hexToRgba(accent, 0.4 + v * 0.6);
        ctx.fillRect(i * barW + 1 * dpr, h - barH, barW - 2 * dpr, barH);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, active]);

  return (
    <div ref={containerRef} className="w-full max-w-[200px]">
      <canvas
        ref={canvasRef}
        className={`audio-viz w-full max-w-[200px] h-8 ${active ? "" : "invisible"}`}
      />
    </div>
  );
}