import { describe, expect, it } from "vitest";
import type { ToolEvent } from "../../lib/protocol";
import { latestPerTool } from "../ActivityPanel";

const ev = (tool: string, status: ToolEvent["status"]): ToolEvent => ({
  event: "tool_event",
  session_id: "s",
  tool,
  status,
  params: {},
  output: null,
});

describe("latestPerTool", () => {
  it("keeps the latest status per tool, most recent last", () => {
    const rows = latestPerTool([ev("a", "running"), ev("b", "running"), ev("a", "success")]);
    expect(rows.map((r) => `${r.tool}:${r.status}`)).toEqual(["b:running", "a:success"]);
  });
});
