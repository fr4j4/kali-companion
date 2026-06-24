import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function ImageWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const [lightbox, setLightbox] = useState(false);

  const imgUrl = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.url && typeof d.url === "string") return d.url;
    if (d.path && typeof d.path === "string") return `/images/${d.path}`;
    return null;
  }, [d]);

  const name = (d.name as string) || (d.title as string) || t("widget.image.fallback");

  return (
    <BaseWidget>
      <div className="relative">
        {/* Image placeholder with gradient */}
        <div
          className="w-full h-40 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent flex items-center justify-center cursor-pointer border-b border-white/5"
          onClick={() => setLightbox(true)}
        >
          {imgUrl ? (
            <img src={imgUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <span className="text-3xl">{'\u{1F5BC}\uFE0F'}</span>
          )}
        </div>

        {/* Info bar */}
        <div className="px-3 py-2 flex items-center justify-between text-xs">
          <span className="text-fg truncate">{name}</span>
          <button
            onClick={() => imgUrl && window.open(imgUrl, "_blank")}
            className="text-muted hover:text-accent transition"
          >
            {t("widget.image.open")}
          </button>
        </div>
      </div>

      {/* Lightbox overlay */}
      {lightbox && imgUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center cursor-pointer"
          onClick={() => setLightbox(false)}
        >
          <img
            src={imgUrl}
            alt={name}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
          >
            {'\u2715'}
          </button>
        </div>
      )}
    </BaseWidget>
  );
}
