// PresenceLayer — ephemeral overlay showing tool activity and reasoning.
//
// This layer sits above the MomentStream and shows transient status: the
// currently-running tool (a small pill near the avatar) and the latest
// reasoning snippet (ThoughtCloud, draggable around the avatar). Also shows a "Thinking…" indicator
// during the gap between send and first token.

import { AnimatePresence, motion } from "framer-motion";
import { Cog, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useStage } from "./StageProvider";
import { ThoughtCloud } from "../components/ThoughtCloud";

interface PresenceLayerProps {
  onExpand?: () => void;
}

export function PresenceLayer({ onExpand }: PresenceLayerProps) {
  const { t } = useTranslation();
  const { chat } = useStage();

  const runningTools = chat.toolEvents.filter((e) => e.status === "running");
  const lastTool = runningTools[runningTools.length - 1];

  // Latest message with reasoning (streaming OR finished).
  const lastMsgWithReasoning = [...chat.messages].reverse().find((m) => m.reasoning);
  const reasoning = lastMsgWithReasoning?.reasoning ?? null;
  const isCurrentlyStreaming = lastMsgWithReasoning?.streaming === true;

  // Dismissal: user can close the cloud; resets when a NEW message starts streaming.
  const [dismissed, setDismissed] = useState(false);
  const lastMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastMsgWithReasoning && lastMsgWithReasoning.id !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastMsgWithReasoning.id;
      setDismissed(false);
    }
  }, [lastMsgWithReasoning]);

  // Thinking indicator: active during initial gap OR while streaming reasoning.
  // Also active during multi-step tool call gaps (turn is active but no delta,
  // no reasoning, no tool running — the LLM is between steps).
  const isStreamingText = chat.messages.some((m) => m.role === "assistant" && m.streaming && m.content);
  const inStepGap = chat.isTurnActive && !lastTool && !reasoning && !isStreamingText;
  const showThinking = (chat.isThinking && !lastTool && !reasoning) || isCurrentlyStreaming || inStepGap;
  const showCloud = reasoning && !dismissed;
  const stepLabel = inStepGap && chat.currentStep > 1 ? ` · ${t("stage.step", { n: chat.currentStep })}` : "";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
      {/* Thinking pill — visible during initial gap AND while streaming */}
      <AnimatePresence>
        {showThinking && (
          <motion.div
            key="thinking-pill"
            className="hud-pill"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{ marginTop: "calc(50vh + (140px * var(--mul-avatar)))" }}
          >
            <Sparkles size={11} className="animate-pulse text-accent" />
            {t("stage.thinking")}{stepLabel}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tool pill — floats above the avatar */}
      <AnimatePresence>
        {lastTool && (
          <motion.div
            key="tool-pill"
            className="hud-pill"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{ marginTop: "calc(50vh + (140px * var(--mul-avatar)))" }}
          >
            <Cog size={11} className="animate-spin text-accent" />
            {lastTool.params?.command
              ? t("tool.running_command", { command: (lastTool.params.command as string).split(" ")[0] })
              : t("tool.running", { tool: lastTool.tool })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reasoning — ThoughtCloud orbitando el avatar (draggable, anclada al avatar center).
          Permanece visible (dimmed) tras el streaming hasta que el usuario la cierre.
          Se reabre automáticamente cuando un nuevo mensaje con razonamiento aparece. */}
      <AnimatePresence>
        {showCloud && (
          <ThoughtCloud
            key="thought-cloud"
            reasoning={reasoning ?? ""}
            isStreaming={isCurrentlyStreaming}
            dimmed={!isCurrentlyStreaming}
            onDismiss={() => setDismissed(true)}
            onExpand={onExpand}
          />
        )}
      </AnimatePresence>
    </div>
  );
}