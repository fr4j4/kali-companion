import { describe, it, expect } from "vitest";
import { connectionPath, layoutNodes, nodeStates, toolToNode } from "../neuralMap";

describe("toolToNode", () => {
  it("maps core tools to their node", () => {
    expect(toolToNode("web_search")).toBe("research");
    expect(toolToNode("run_command")).toBe("code");
    expect(toolToNode("look_at_screen")).toBe("screen");
    expect(toolToNode("fs_read")).toBe("files");
    expect(toolToNode("launch_app")).toBe("desktop");
    expect(toolToNode("game_start")).toBe("games");
  });
  it("ignores unknown tools", () => {
    expect(toolToNode("nope")).toBeNull();
  });
});

describe("nodeStates", () => {
  const idle = { listening: false, speaking: false };
  it("is idle with no events", () => {
    expect(Object.values(nodeStates([], idle)).every((s) => s === "idle")).toBe(true);
  });
  it("activates the node of a running tool and clears it once finished", () => {
    expect(nodeStates([{ tool: "web_search", status: "running" }], idle).research).toBe("active");
    expect(nodeStates([{ tool: "web_search", status: "running" }, { tool: "web_search", status: "success" }], idle).research).toBe("idle");
  });
  it("lights the voice node while listening or speaking", () => {
    expect(nodeStates([], { listening: true, speaking: false }).voice).toBe("active");
    expect(nodeStates([], { listening: false, speaking: true }).voice).toBe("active");
  });
});

describe("layoutNodes", () => {
  it("returns null on stages too small for a map", () => {
    expect(layoutNodes({ w: 600, h: 800 }, { x: 300, y: 350 }, 110)).toBeNull();
  });
  it("places all seven nodes on wide stages, inside the stage and clear of the avatar", () => {
    const stage = { w: 1440, h: 900 };
    const center = { x: 720, y: 396 };
    const map = layoutNodes(stage, center, 110)!;
    expect(map.nodes).toHaveLength(7);
    for (const n of map.nodes) {
      expect(n.pos.x).toBeGreaterThan(60);
      expect(n.pos.x).toBeLessThan(stage.w - 60);
      expect(n.pos.y).toBeGreaterThan(80);
      expect(n.pos.y).toBeLessThan(stage.h * 0.8);
      expect(Math.hypot(n.pos.x - center.x, n.pos.y - center.y)).toBeGreaterThan(110 + 40);
    }
  });
  it("keeps only the essential nodes on narrower stages", () => {
    const map = layoutNodes({ w: 1100, h: 800 }, { x: 550, y: 352 }, 110)!;
    expect(map.nodes.map((n) => n.id)).not.toContain("screen");
    expect(map.nodes.length).toBe(5);
  });
});

describe("connectionPath", () => {
  it("starts on the avatar edge and ends on the node", () => {
    const d = connectionPath({ x: 0, y: 0 }, 100, { x: 300, y: 0 });
    expect(d.startsWith("M 100 0 C")).toBe(true);
    expect(d.endsWith("300 0")).toBe(true);
  });
});
