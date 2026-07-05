// ConsentModal — shows when the agent wants to run a tool that needs consent.
//
// Displays the tool name, a reason (i18n key), and allow/cancel buttons.
// Auto-cancels after 60s timeout.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConsentRequestEvent } from "../lib/protocol";
import { Modal } from "./ui/Modal";

interface Props {
  request: ConsentRequestEvent | null;
  onRespond: (id: string, decision: "allow" | "no_capture" | "cancel") => void;
}

export function ConsentModal({ request, onRespond }: Props) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (!request) {
      setCountdown(60);
      return;
    }
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          onRespond(request.id, "cancel");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [request, onRespond]);

  if (!request) return null;

  const reasonParams = request.reason_params || {};
  const hasReason = Boolean(reasonParams.reason && String(reasonParams.reason).trim());
  const reasonKey = hasReason ? request.reason_key : `${request.reason_key}.generic`;
  const reasonText = t(reasonKey, { defaultValue: "", ...reasonParams });
  const summaryText = t(request.summary_key, { defaultValue: request.tool });
  const isScreenshot = request.tool === "screenshot";
  const commandText = request.tool === "run_command" ? String(reasonParams.command || "") : "";

  return (
    <Modal open={!!request} onClose={() => request && onRespond(request.id, "cancel")} title={summaryText}>
      <>
        <p className="text-sm leading-relaxed my-0">{reasonText}</p>
        {commandText && (
          <div className="mt-3 mb-1">
            <div className="text-xs text-muted mb-1">{t("consent.command_label")}</div>
            <pre className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-fg overflow-x-auto whitespace-pre-wrap break-all">
              {commandText}
            </pre>
          </div>
        )}
        <div className="text-xs text-muted text-center mb-3">{countdown}s</div>
        <div className="flex gap-2.5 justify-end max-sm:flex-col">
          <button
            className="border-none rounded-[10px] px-3.5 py-2.5 text-sm cursor-pointer bg-accent text-white hover:brightness-110 max-lg:min-h-[44px]"
            onClick={() => onRespond(request.id, "allow")}
          >
            {t("consent.allow")}
          </button>
          {isScreenshot && (
            <button
              className="bg-surface text-muted border border-border rounded-[10px] px-3.5 py-2.5 text-sm cursor-pointer hover:bg-accent-dim hover:text-foreground max-lg:min-h-[44px]"
              onClick={() => onRespond(request.id, "no_capture")}
            >
              {t("consent.no_capture")}
            </button>
          )}
          <button
            className="border-none rounded-[10px] px-3.5 py-2.5 text-sm cursor-pointer bg-err text-white hover:brightness-110 max-lg:min-h-[44px]"
            onClick={() => onRespond(request.id, "cancel")}
          >
            {t("consent.cancel")}
          </button>
        </div>
      </>
    </Modal>
  );
}