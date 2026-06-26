import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
  variant?: "audio" | "video";
}

export function MediaWidget({ content, variant = "audio" }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setProgress((p) => Math.min(100, p + 1));
    }, 200);
    return () => clearInterval(interval);
  }, [playing]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {variant === "audio" ? (
          /* Audio: Vinyl + EQ bars */
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0">
              <div className={`w-full h-full rounded-full border-2 border-white/10 ${playing ? "spin-active" : ""}`}>
                <div className="w-full h-full rounded-full bg-gradient-to-br from-accent/30 to-accent/5 flex items-center justify-center">
                  <span className="text-2xl">{'\u266B'}</span>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-elevated border border-white/20" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg truncate">{(d.title as string) || t("widget.media.sample_track")}</div>
              <div className="flex items-end gap-0.5 h-8 mt-2">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="eq-bar flex-1 rounded-full bg-accent/60"
                    style={{
                      height: playing ? `${Math.random() * 15 + 3}px` : "3px",
                      animationDelay: `${i * 0.05}s`,
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted mt-2">
                <span>{formatTime(Math.floor(progress * (d.duration as number || 180) / 100))}</span>
                <span>{formatTime((d.duration as number) || 180)}</span>
              </div>
              {/* Seek bar */}
              <div className="relative h-1 bg-white/10 rounded-full mt-1 cursor-pointer" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setProgress(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
              }}>
                <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shrink-0 hover:brightness-110 transition">
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              )}
            </button>
          </div>
        ) : (
          /* Video: Player */
          <div className="video-container relative rounded-lg overflow-hidden bg-black/40 aspect-video flex items-center justify-center border border-white/5">
            <div className="text-center">
              <span className="text-4xl text-muted">{'\u{1F3AC}'}</span>
              <div className="text-xs text-muted mt-1">{(d.title as string) || t("widget.media.sample_video")}</div>
            </div>
            {/* Controls overlay */}
            <div className="video-controls absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-center gap-3">
              <button onClick={togglePlay} className="text-white hover:text-accent transition">
                {playing ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                )}
              </button>
              <div className="flex-1 h-1 bg-white/20 rounded-full relative cursor-pointer" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setProgress(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
              }}>
                <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-white/70">{formatTime(Math.floor(progress * 120 / 100))}</span>
            </div>
          </div>
        )}
      </div>
    </BaseWidget>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
