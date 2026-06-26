import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  content?: unknown;
  onToast?: (msg: string, type: "ok" | "err" | "info" | "warn") => void;
  onBeep?: () => void;
  children?: ReactNode;
  className?: string;
}

export function BaseWidget({ children, className = "" }: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.classList.add("entering");
    const timer = setTimeout(() => el.classList.remove("entering"), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={elRef}
      className={`widget-body flex flex-1 flex-col min-h-0 overflow-y-auto ${className}`}
    >
      {children}
    </div>
  );
}
