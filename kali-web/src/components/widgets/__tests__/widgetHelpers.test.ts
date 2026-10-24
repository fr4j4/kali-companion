import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../DiffWidget";
import { chartModel, niceTicks } from "../ChartWidget";
import { cellRef, colLetter, toNumber } from "../TableWidget";
import { codeFiles, treeRows } from "../CodeWidget";
import { headingsOf, markSuggestions, wordCount } from "../DocumentWidget";
import { diagramStats } from "../MermaidWidget";
import { formatDuration } from "../TerminalWidget";
import { hostOf } from "../LinkWidget";

describe("parseUnifiedDiff", () => {
  it("splits files and numbers both sides", () => {
    const files = parseUnifiedDiff([
      "diff --git a/a.css b/a.css", "--- a/a.css", "+++ b/a.css", "@@ -8,3 +8,3 @@", " x {", "-  a: 1;", "+  a: 2;", " }",
      "diff --git a/b.js b/b.js", "--- a/b.js", "+++ b/b.js", "@@ -1,1 +1,2 @@", " one", "+two", "",
    ].join("\n"));
    expect(files.map((f) => [f.path, f.add, f.del])).toEqual([["a.css", 1, 1], ["b.js", 1, 0]]);
    const lines = files[0].hunks[0].lines;
    expect(lines[0]).toMatchObject({ kind: " ", old: 8, new: 8 });
    expect(lines[1]).toMatchObject({ kind: "-", old: 9, new: null });
    expect(lines[2]).toMatchObject({ kind: "+", old: null, new: 9 });
    expect(lines[3]).toMatchObject({ kind: " ", old: 10, new: 10 });
  });

  it("keeps a removed '-- comment' line inside a hunk", () => {
    const [f] = parseUnifiedDiff(["--- a/q.sql", "+++ b/q.sql", "@@ -1,2 +1,1 @@", "--- old comment", " select 1;"].join("\n"));
    expect(f.del).toBe(1);
    expect(f.hunks[0].lines[0]).toMatchObject({ kind: "-", text: "-- old comment" });
  });

  it("reads a bare list of +/- lines as one file", () => {
    const [f] = parseUnifiedDiff("+a\n-b\n c");
    expect([f.add, f.del, f.hunks[0].lines.length]).toEqual([1, 1, 3]);
  });
});

describe("chartModel", () => {
  it("reads labels, series and target", () => {
    const m = chartModel({ labels: ["a", "b"], series: [{ name: "S", values: [1, 2] }], target: { label: "Meta", value: 2 } });
    expect(m.series).toEqual([{ name: "S", values: [1, 2] }]);
    expect(m.target).toEqual({ label: "Meta", value: 2 });
    expect(m.kind).toBe("line");
  });

  it("turns the old rows shape into one series per numeric column", () => {
    const m = chartModel({ data: [{ name: "Mon", a: 1, b: "2" }, { name: "Tue", a: 3, b: 4 }] });
    expect(m.labels).toEqual(["Mon", "Tue"]);
    expect(m.series.map((s) => s.name)).toEqual(["a", "b"]);
    expect(m.series[1].values).toEqual([2, 4]);
  });

  it("never draws more than four series", () => {
    const m = chartModel({ labels: ["x"], series: Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, values: [i] })) });
    expect(m.series).toHaveLength(4);
    expect(m.dropped).toBe(2);
  });

  it("ticks cover the range with round steps", () => {
    const t = niceTicks(720, 905);
    expect(t[0]).toBeLessThanOrEqual(720);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(905);
    expect(t).toEqual([700, 800, 900, 1000]);
  });
});

describe("spreadsheet helpers", () => {
  it("names columns and cells like a spreadsheet", () => {
    expect([colLetter(0), colLetter(25), colLetter(26), colLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
    expect(cellRef(1, 0)).toBe("B2");
  });

  it("reads numbers written by people", () => {
    expect(toNumber("4.870")).toBe(4870);
    expect(toNumber("4,870")).toBe(4870);
    expect(toNumber("1,5")).toBe(1.5);
    expect(toNumber("-35")).toBe(-35);
    expect(toNumber("+10")).toBe(10);
    expect(toNumber("12%")).toBe(12);
    expect(toNumber("Bajo meta")).toBeNull();
  });
});

describe("code helpers", () => {
  it("builds a folder tree from paths", () => {
    expect(treeRows(["src/a.ts", "src/lib/b.ts", "README.md"]).map((r) => `${r.depth}${r.dir ? "d" : "f"}:${r.name}`))
      .toEqual(["0f:README.md", "0d:src", "1f:a.ts", "1d:lib", "2f:b.ts"]);
  });

  it("accepts one file or a project", () => {
    expect(codeFiles({ code: "x", filename: "a.py" }).files[0].path).toBe("a.py");
    const p = codeFiles({ files: [{ path: "a.ts", content: "1", status: "M", changed: [1, "x"] }] });
    expect(p.files[0]).toMatchObject({ path: "a.ts", code: "1", status: "M", changed: [1] });
    expect(codeFiles({}).sample).toBe(true);
  });
});

describe("document helpers", () => {
  it("lists headings outside code fences", () => {
    expect(headingsOf("# A\n```\n# no\n```\n## B").map((h) => h.text)).toEqual(["A", "B"]);
  });

  it("marks a suggestion in the html", () => {
    const html = markSuggestions("<p>cada tres años.</p>", [{ id: "s1", old: "tres", new: "cinco" }]);
    expect(html).toBe('<p>cada <del class="kw-sug-old" data-sug="s1">tres</del><ins class="kw-sug-new" data-sug="s1">cinco</ins> años.</p>');
  });

  it("counts words without markup", () => {
    expect(wordCount("# Title\n\nTwo **words**")).toBe(3);
  });
});

describe("small helpers", () => {
  it("counts the steps and decisions of a flowchart", () => {
    expect(diagramStats("flowchart LR\n A[Uno] --> B{¿Sí?}\n B -- Sí --> C[Tres]\n B --> D(Cuatro)")).toEqual({ kind: "flowchart", nodes: 4, decisions: 1 });
  });

  it("says durations briefly", () => {
    expect(formatDuration(312)).toBe("312 ms");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });

  it("shows a link's site", () => {
    expect(hostOf("https://www.example.com/a?b")).toBe("example.com");
    expect(hostOf("nope")).toBe("nope");
  });
});
