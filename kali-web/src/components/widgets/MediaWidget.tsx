/**
 * MediaWidget — audio or video Kali found or made.
 *
 * With a real source (`url` / `src`) it plays it: video with the browser's own controls inside a
 * dark frame, audio as a card with cover, title, artist, play, a seek bar and the times. Without
 * one it shows the card as a sample, without pretending to play.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Music, Play, Pause, Film } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
  variant?: "audio" | "video";
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function MediaWidget({ content, variant = "audio" }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const src = (typeof d.url === "string" && d.url) || (typeof d.src === "string" && d.src) || "";
  const kind: "audio" | "video" = d.kind === "video" || d.type === "video" || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src) ? "video" : d.kind === "audio" ? "audio" : variant;
  const title = (d.title as string) || (kind === "audio" ? t("widget.media.sample_track") : t("widget.media.sample_video"));
  const artist = typeof d.artist === "string" ? d.artist : typeof d.author === "string" ? d.author : "";
  const cover = typeof d.cover === "string" ? d.cover : typeof d.image === "string" ? d.image : "";

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(typeof d.duration === "number" ? d.duration : 0);

  useEffect(() => { setPlaying(false); setTime(0); }, [src]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !src) return;
    if (a.paused) void a.play(); else a.pause();
  }, [src]);

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };

  useShellSubtitle(artist || (src ? src.split("/").pop()?.split("?")[0] ?? null : null));
  useShellSample(!isReal || !src);

  return (
    <BaseWidget>
      {kind === "video" ? (
        <div className="kw-video">
          {src ? (
            <video src={src} controls preload="metadata" poster={cover || undefined} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
          ) : (
            <div className="kw-empty-state"><span className="kw-empty-icon"><Film size={22} aria-hidden="true" /></span><p>{title}</p></div>
          )}
        </div>
      ) : (
        <div className="kw-audio">
          <span className="kw-audio-cover">{cover ? <img src={cover} alt="" /> : <Music size={28} aria-hidden="true" />}</span>
          <div className="kw-audio-main">
            <div className="kw-audio-title">{title}</div>
            {artist && <div className="kw-audio-artist">{artist}</div>}
            <div
              className="kw-audio-seek"
              role="slider"
              aria-label={t("v2.media.position") as string}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(time)}
              tabIndex={src ? 0 : -1}
              onPointerDown={seek}
              onKeyDown={(e) => {
                const a = audioRef.current;
                if (!a) return;
                if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + 5);
                if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5);
              }}
            >
              <div style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
            </div>
            <div className="kw-audio-times kw-mono"><span>{formatTime(time)}</span><span>{formatTime(duration)}</span></div>
          </div>
          <button type="button" className="kw-play" onClick={toggle} disabled={!src} aria-label={(playing ? t("v2.media.pause") : t("v2.media.play")) as string}>
            {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          </button>
          {src && (
            <audio
              ref={audioRef}
              src={src}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
          )}
        </div>
      )}
      <WidgetFooter>
        <span className="v2-foot-item">{kind === "video" ? t("v2.media.video") : t("v2.media.audio")}</span>
        {duration > 0 && <span className="v2-foot-item kw-mono">{formatTime(duration)}</span>}
        {!src && <span className="v2-foot-item">{t("v2.media.no_source")}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
