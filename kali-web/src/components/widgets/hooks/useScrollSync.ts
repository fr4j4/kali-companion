import { useState, useRef, useCallback, useEffect } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

export function useScrollSync() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const hTags = el.querySelectorAll("h1, h2, h3");
    const hList: Heading[] = [];
    hTags.forEach((h, i) => {
      const id = `heading-${i}`;
      h.id = id;
      hList.push({ id, text: h.textContent || "", level: parseInt(h.tagName[1]) });
    });
    setHeadings(hList);
  }, [contentRef]);

  const onTocClick = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return { tocRef, contentRef, headings, onTocClick };
}
