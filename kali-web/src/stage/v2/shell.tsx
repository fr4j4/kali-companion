/**
 * stage/v2/shell.tsx — What a widget can tell the window frame around it.
 *
 * ArtifactShell owns the header (icon, title, subtitle, status pill, actions), the progress line
 * and the status footer. A widget only draws its body; through this context it can put buttons in
 * the header, facts in the footer, and override the subtitle, status or progress. Outside a shell
 * (legacy canvas, native artifact window) every hook is a harmless no-op, so widgets stay portable.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ShellStatusKind = "writing" | "permission" | "updating" | "running" | "done" | "saved" | "error";
export interface ShellStatus { kind: ShellStatusKind; label?: string }

export interface ShellApi {
  actionsEl: HTMLElement | null;
  footerEl: HTMLElement | null;
  toolbarEl: HTMLElement | null;
  /** The panel is small: show the result only, no controls. */
  compact: boolean;
  setSubtitle: (s: string | null) => void;
  setStatus: (s: ShellStatus | null) => void;
  setProgress: (p: number | null) => void;
  setSample: (sample: boolean) => void;
}

const noop = () => {};
const NO_SHELL: ShellApi = {
  actionsEl: null, footerEl: null, toolbarEl: null, compact: false,
  setSubtitle: noop, setStatus: noop, setProgress: noop, setSample: noop,
};

export const ShellContext = createContext<ShellApi>(NO_SHELL);

export function useShell(): ShellApi {
  return useContext(ShellContext);
}

/** True when the widget renders inside the v2 frame (so it should not draw its own header row). */
export function useInShell(): boolean {
  return useContext(ShellContext) !== NO_SHELL;
}

/** Buttons for the window header (32 px icon buttons). Falls back to rendering in place. */
export function ShellActions({ children, fallback = true }: { children: ReactNode; fallback?: boolean }) {
  const { actionsEl } = useShell();
  if (actionsEl) return createPortal(children, actionsEl);
  return fallback ? <>{children}</> : null;
}

/** Facts for the 30 px status footer (branch, language, "updated 2 s ago"…). */
export function ShellFooter({ children }: { children: ReactNode }) {
  const { footerEl } = useShell();
  if (footerEl) return createPortal(children, footerEl);
  return null;
}

/** Override the header subtitle while mounted. */
export function useShellSubtitle(subtitle: string | null | undefined) {
  const { setSubtitle } = useShell();
  useEffect(() => {
    setSubtitle(subtitle ?? null);
    return () => setSubtitle(null);
  }, [subtitle, setSubtitle]);
}

/** Override the header status pill while mounted. */
export function useShellStatus(status: ShellStatus | null) {
  const { setStatus } = useShell();
  const kind = status?.kind;
  const label = status?.label;
  useEffect(() => {
    setStatus(kind ? { kind, label } : null);
    return () => setStatus(null);
  }, [kind, label, setStatus]);
}

/** Report real progress (0–1) for the top progress line. */
export function useShellProgress(progress: number | null | undefined) {
  const { setProgress } = useShell();
  useEffect(() => {
    setProgress(progress ?? null);
    return () => setProgress(null);
  }, [progress, setProgress]);
}

/** Say the window shows sample data instead of real data ("Datos de ejemplo" in the footer). */
export function useShellSample(sample: boolean) {
  const { setSample } = useShell();
  useEffect(() => {
    setSample(sample);
    return () => setSample(false);
  }, [sample, setSample]);
}
