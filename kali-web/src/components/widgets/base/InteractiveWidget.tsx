import { useEffect, useRef, type ReactNode } from "react";
import { BaseWidget } from "./BaseWidget";

interface Props {
  content?: unknown;
  onToast?: (msg: string, type: "ok" | "err" | "info" | "warn") => void;
  onBeep?: () => void;
  active?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}

export function InteractiveWidget({ content, onToast, onBeep, children }: Props) {
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearInterval);
      timersRef.current = [];
    };
  }, []);

  return (
    <BaseWidget content={content} onToast={onToast} onBeep={onBeep}>
      {children}
    </BaseWidget>
  );
}
