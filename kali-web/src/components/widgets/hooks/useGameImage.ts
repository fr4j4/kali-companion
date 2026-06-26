import { useEffect, useState } from "react";

export function useGameImage(
  imgPath: string | undefined,
  imageReadyKeys?: Set<string>,
  onRequestImage?: (key: string) => void,
) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!imgPath) { setState("error"); return; }
    const parts = imgPath.replace(/\.png$/, "").split("/");
    const key = parts.join(":");
    if (imageReadyKeys?.has(key)) { setState("ready"); return; }
    const url = `/images/${imgPath}`;
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (r.ok) setState("ready");
        else { setState("loading"); onRequestImage?.(key); }
      })
      .catch(() => { setState("loading"); onRequestImage?.(key); });
  }, [imgPath, imageReadyKeys, onRequestImage]);

  useEffect(() => {
    if (!imgPath) return;
    const parts = imgPath.replace(/\.png$/, "").split("/");
    const key = parts.join(":");
    if (imageReadyKeys?.has(key)) setState("ready");
  }, [imageReadyKeys, imgPath]);

  return {
    imgSrc: imgPath ? `/images/${imgPath}` : null,
    loading: state === "loading",
    error: state === "error",
  };
}
