import type { ConsentRequestEvent } from "./protocol";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The sentences shown for a consent question, in the chat modal and in the system dialog. */
export function consentTexts(request: ConsentRequestEvent, t: Translate) {
  const params = request.reason_params || {};
  const hasReason = Boolean(params.reason && String(params.reason).trim());
  const reasonKey = hasReason ? request.reason_key : `${request.reason_key}.generic`;
  return {
    summary: t(request.summary_key, { defaultValue: request.tool }),
    reason: t(reasonKey, { defaultValue: "", ...params }),
    command: request.tool === "run_command" ? String(params.command || "") : "",
  };
}
