/**
 * stage/v2/useWindowStatus.ts — What each window is doing now, for its header pill and its tab dot.
 *
 * Permission when the pending consent names the window (or a terminal command is asked), writing
 * or updating while the artifact streams, running while a terminal command runs, and done for a
 * few seconds after streaming ends. Also tracks when each window's content last changed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactEvent } from "../../lib/protocol";
import type { WindowData } from "../../workspace/types";
import { useStage } from "../StageProvider";
import type { ShellStatus } from "./shell";

export const DONE_SHOW_MS = 6000;

export interface WindowStatusApi {
  status: Map<number, ShellStatus | null>;
  updatedAt: (id: number) => number | undefined;
}

export function useWindowStatus(windows: WindowData[]): WindowStatusApi {
  const { chat } = useStage();
  const updatedRef = useRef(new Map<number, { content: unknown; at: number; phase?: string }>());
  const [doneAt, setDoneAt] = useState<Record<number, number>>({});

  useEffect(() => {
    const now = Date.now();
    const finished: Record<number, number> = {};
    for (const w of windows) {
      const prev = updatedRef.current.get(w.id);
      const ev = w.content as ArtifactEvent | null;
      const phase = ev && typeof ev === "object" ? ev.phase : undefined;
      if (!prev) { updatedRef.current.set(w.id, { content: w.content, at: now, phase }); continue; }
      if (prev.content !== w.content) {
        if (prev.phase === "streaming" && phase !== "streaming") finished[w.id] = now;
        updatedRef.current.set(w.id, { content: w.content, at: now, phase });
      }
    }
    if (Object.keys(finished).length) setDoneAt((d) => ({ ...d, ...finished }));
  }, [windows]);

  useEffect(() => {
    if (!Object.keys(doneAt).length) return;
    const timer = window.setTimeout(() => setDoneAt({}), DONE_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [doneAt]);

  const terminalRunning = useMemo(() => {
    for (const s of chat.terminalSessions.values()) for (const c of s.commands.values()) if (c.status === "running") return true;
    return false;
  }, [chat.terminalSessions]);

  const consent = chat.consentRequest && !chat.consentRequest.handled_by_agent ? chat.consentRequest : null;

  const status = useMemo(() => {
    const out = new Map<number, ShellStatus | null>();
    for (const w of windows) {
      if (w.closed) continue;
      let st: ShellStatus | null = null;
      const asks = consent && (consent.artifact_id ? consent.artifact_id === w.artifactId : w.type === "terminal" && (consent.tool === "run_command" || consent.tool === "run_tests"));
      const ev = w.content as ArtifactEvent | null;
      if (asks) st = { kind: "permission" };
      else if (ev && typeof ev === "object" && ev.phase === "streaming") st = { kind: w.type === "html" || w.type === "table" || w.type === "chart" ? "updating" : "writing" };
      else if (w.type === "terminal" && terminalRunning) st = { kind: "running" };
      else if (doneAt[w.id]) st = { kind: "done" };
      out.set(w.id, st);
    }
    return out;
  }, [windows, consent, terminalRunning, doneAt]);

  return { status, updatedAt: (id) => (windows.find((w) => w.id === id)?.artifactId ? updatedRef.current.get(id)?.at : undefined) };
}
