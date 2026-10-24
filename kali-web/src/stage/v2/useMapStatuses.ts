/**
 * stage/v2/useMapStatuses.ts — Live node states for the map and the inspector.
 *
 * Recomputes from the tool log, consent, memory and voice, and wakes up only when a timed state
 * (done, failed, recalling) is due to fade, never per frame.
 */

import { useEffect, useMemo, useState } from "react";
import type { ArtifactEvent } from "../../lib/protocol";
import type { WindowData } from "../../workspace/types";
import { useStage } from "../StageProvider";
import {
  ARTIFACT_NODE, DONE_MS, FAILED_MS, RECALL_MS, nodeStatuses, visibleNodes,
  type ArtifactActivity, type NodeId, type NodeStatus,
} from "./mapModel";

export function useMapStatuses(groupWindows: WindowData[]): { nodes: NodeId[]; statuses: Record<string, NodeStatus> } {
  const { chat, ptt, tts } = useStage();
  const [tick, setTick] = useState(0);

  const artifacts = useMemo<ArtifactActivity[]>(() => {
    const out: ArtifactActivity[] = [];
    for (const w of groupWindows) {
      const node = ARTIFACT_NODE[w.type];
      if (!node) continue;
      const ev = w.content as ArtifactEvent | null;
      out.push({ node, title: w.title, writing: !!ev && typeof ev === "object" && ev.phase === "streaming", at: Date.now() });
    }
    return out;
  }, [groupWindows]);

  const listening = ptt.state === "recording";
  const speaking = tts.playing;
  const consentTool = chat.consentRequest && !chat.consentRequest.handled_by_agent ? chat.consentRequest.tool : null;

  const statuses = useMemo(
    () => nodeStatuses({
      toolEvents: chat.toolEvents,
      consentTool,
      memory: chat.memoryEvents,
      voice: { listening, speaking },
      artifacts,
      now: Date.now(),
    }),
    // tick re-evaluates timed states
    [chat.toolEvents, consentTool, chat.memoryEvents, listening, speaking, artifacts, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Wake up when the next timed state fades.
  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const st of Object.values(statuses)) {
      if (st.state === "done") next = Math.min(next, st.since + DONE_MS);
      if (st.state === "failed") next = Math.min(next, st.since + FAILED_MS);
      if (st.state === "recalling") next = Math.min(next, st.since + RECALL_MS);
    }
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), Math.max(50, next - now + 20));
    return () => window.clearTimeout(timer);
  }, [statuses]);

  const nodes = useMemo(() => visibleNodes({ artifacts }), [artifacts]);
  return { nodes, statuses };
}
