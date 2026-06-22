import { useEffect, useState } from "react";

interface Props {
  imgPath: string;
  alt: string;
  className?: string;
  fallbackEmoji?: string;
  imageReadyKeys: Set<string>;
  onRequestImage: (key: string) => void;
}

function pathToKey(imgPath: string): string {
  const parts = imgPath.replace(/\.png$/, "").split("/");
  return parts.join(":");
}

export function GameImage({
  imgPath,
  alt,
  className = "",
  fallbackEmoji = "📦",
  imageReadyKeys,
  onRequestImage,
}: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const key = pathToKey(imgPath);

  useEffect(() => {
    if (!imgPath) {
      setState("error");
      return;
    }
    if (imageReadyKeys.has(key)) {
      setState("ready");
      return;
    }
    const url = `/images/${imgPath}`;
    fetch(url, { method: "HEAD" })
      .then((resp) => {
        if (resp.ok) {
          setState("ready");
        } else {
          setState("loading");
          if (key) onRequestImage(key);
        }
      })
      .catch(() => {
        setState("loading");
        if (key) onRequestImage(key);
      });
  }, [imgPath, key, imageReadyKeys, onRequestImage]);

  useEffect(() => {
    if (imageReadyKeys.has(key)) {
      setState("ready");
    }
  }, [imageReadyKeys, key]);

  const url = `/images/${imgPath}`;

  if (state === "error") {
    return <span className={className}>{fallbackEmoji}</span>;
  }

  if (state === "loading") {
    return (
      <span className={`${className} inline-flex items-center justify-center`}>
        <span className="animate-spin inline-block w-4 h-4 border-2 border-muted border-t-transparent rounded-full" />
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => setState("error")}
      loading="lazy"
    />
  );
}
