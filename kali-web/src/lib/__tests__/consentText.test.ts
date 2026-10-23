import { describe, expect, it } from "vitest";
import { consentTexts } from "../consentText";
import type { ConsentRequestEvent } from "../protocol";

const t = (key: string, options?: Record<string, unknown>) => `${key}|${JSON.stringify(options ?? {})}`;
const base: ConsentRequestEvent = { event: "consent_request", id: "c1", session_id: "s", tool: "run_command", risk: "dangerous", reason_key: "consent.reason.run_command", reason_params: { command: "df -h" }, summary_key: "consent.summary.run_command" };

describe("consent texts", () => {
  it("exposes the command for run_command and uses the plain reason without one", () => {
    const texts = consentTexts(base, t);
    expect(texts.command).toBe("df -h");
    expect(texts.reason.startsWith("consent.reason.run_command.generic|")).toBe(true);
    expect(texts.summary.startsWith("consent.summary.run_command|")).toBe(true);
  });

  it("uses the specific reason when the core gave one, and no command for other tools", () => {
    const texts = consentTexts({ ...base, tool: "screenshot", reason_key: "consent.reason.screenshot", reason_params: { reason: "ver el error" } }, t);
    expect(texts.reason.startsWith("consent.reason.screenshot|")).toBe(true);
    expect(texts.command).toBe("");
  });

  it("names the machine when the core says where the call runs", () => {
    const texts = consentTexts({ ...base, reason_params: { command: "df -h", where: "[server]" } }, t);
    expect(texts.reason.endsWith(" [server]")).toBe(true);
    expect(consentTexts(base, t).reason.endsWith("]")).toBe(false);
  });
});
