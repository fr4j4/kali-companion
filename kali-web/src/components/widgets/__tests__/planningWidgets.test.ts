import { describe, expect, it } from "vitest";
import { claimGroups } from "../SourcesWidget";
import { readTasks } from "../TasksWidget";
import { matchesNote, readNotes } from "../NotesWidget";
import { dayKey, minutesOf, mondayOf, parseDay } from "../CalendarWidget";
import { pdfSrc } from "../PdfWidget";

describe("claimGroups", () => {
  it("orders claims by support and gives the first two their own colour", () => {
    const g = claimGroups([
      { title: "a", claim: "3 años" }, { title: "b", claim: "5 años" }, { title: "c", claim: " 5 años " },
      { title: "d", claim: "nunca" }, { title: "e" },
    ]);
    expect(g.map((x) => [x.claim, x.count, x.tone])).toEqual([["5 años", 2, 0], ["3 años", 1, 1], ["nunca", 1, 2]]);
  });
});

describe("readTasks", () => {
  it("normalises status, owner and progress", () => {
    const t = readTasks({ tasks: [
      { title: "a", status: "in_progress", owner: "kali", progress: 70 },
      { title: "b", status: "weird", owner: "someone", progress: 0.25 },
      { nope: true },
    ] })!;
    expect(t).toEqual([
      { title: "a", status: "doing", owner: "kali", due: undefined, progress: 0.7 },
      { title: "b", status: "todo", owner: "you", due: undefined, progress: 0.25 },
    ]);
    expect(readTasks({ items: [] })).toBeNull();
  });
});

describe("notes", () => {
  it("reads kinds and searches every word in title, text and list", () => {
    const n = readNotes({ notes: [{ title: "Compras", items: ["Aceite fino"] }, { title: "Ver", kind: "reminder", when: "17:00" }] })!;
    expect(n[0].kind).toBe("list");
    expect(n[1].kind).toBe("reminder");
    expect(matchesNote(n[0], "aceite compras")).toBe(true);
    expect(matchesNote(n[0], "aceite grueso")).toBe(false);
    expect(matchesNote(n[1], "")).toBe(true);
  });
});

describe("calendar dates", () => {
  it("parses local days and finds the Monday", () => {
    const d = parseDay("2026-10-23")!;
    expect(dayKey(d)).toBe("2026-10-23");
    expect(dayKey(mondayOf(d))).toBe("2026-10-19");
    expect(dayKey(mondayOf(parseDay("2026-10-25")!))).toBe("2026-10-19");
    expect(parseDay("23/10")).toBeNull();
    expect(minutesOf("9:30")).toBe(570);
    expect(minutesOf("x")).toBeNull();
  });
});

describe("pdfSrc", () => {
  it("replaces any fragment with the page and zoom", () => {
    expect(pdfSrc("/file?path=%2Fa.pdf#page=9", 2, 110)).toBe("/file?path=%2Fa.pdf#page=2&zoom=110");
  });
});
