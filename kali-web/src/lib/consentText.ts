import type { ConsentRequestEvent } from "./protocol";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The sentences shown for a consent question, in the chat modal and in the system dialog. */
export function consentTexts(request: ConsentRequestEvent, t: Translate) {
  const params = request.reason_params || {};
  const hasReason = Boolean(params.reason && String(params.reason).trim());
  const reasonKey = hasReason ? request.reason_key : `${request.reason_key}.generic`;
  // Which machine runs it ("[server]"), when the core says so.
  const where = params.where ? ` ${String(params.where)}` : "";
  return {
    summary: t(request.summary_key, { defaultValue: request.tool }),
    reason: `${t(reasonKey, { defaultValue: "", ...params })}${where}`.trim(),
    command: request.tool === "run_command" ? String(params.command || "") : "",
  };
}
