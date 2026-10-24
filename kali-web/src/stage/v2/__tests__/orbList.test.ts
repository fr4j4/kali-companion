import { describe, expect, it } from "vitest";
import { orbRows } from "../OrbList";
import type { NodeStatus } from "../mapModel";

const st = (id: NodeStatus["id"], state: NodeStatus["state"], since = 0): NodeStatus => ({ id, state, since, points: [] });

describe("orbRows", () => {
  it("folds everything at rest into one row", () => {
    const r = orbRows(["files", "research", "code"], { files: st("files", "idle"), research: st("research", "idle") });
    expect(r.active).toEqual([]);
    expect(r.resting).toEqual(["files", "research", "code"]);
  });
  it("lists busy nodes, the ones asking first", () => {
    const r = orbRows(["files", "research", "terminal"], {
      files: st("files", "working", 10),
      research: st("research", "working", 20),
      terminal: st("terminal", "permission", 5),
    });
    expect(r.active.map((s) => s.id)).toEqual(["terminal", "research", "files"]);
    expect(r.resting).toEqual([]);
  });
  it("keeps a failed node visible", () => {
    const r = orbRows(["files", "screen"], { screen: st("screen", "failed") });
    expect(r.active.map((s) => s.id)).toEqual(["screen"]);
    expect(r.resting).toEqual(["files"]);
  });
});
