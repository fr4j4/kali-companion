/**
 * TableWidget — a spreadsheet to order, calculate and compare figures.
 *
 * Column letters and row numbers, numbers right-aligned in a fixed-width face, a formula bar with
 * the active cell, and the sum and average of the selection in the footer. Optional extras from
 * the core: `formulas: { "B8": "=SUMA(B2:B7)" }`, Kali's notes per cell (`notes: { "D7": "…" }`,
 * a small triangle in the corner; the note opens toward where there is room), words coloured by
 * tone (`tones: { "Bajo meta": "err", "Sobre meta": "ok" }`) and several sheets
 * (`sheets: [{ name, rows }]`).
 */

import { useMemo, useState, useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { MessageSquare } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_TABLE_DATA } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

type Row = Record<string, unknown>;
interface Cell { r: number; c: number }

export const colLetter = (i: number): string => {
  let s = "";
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
/** "B3" for column 1, data row 1 (row 1 is the header). */
export const cellRef = (c: number, r: number) => `${colLetter(c)}${r + 2}`;

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s/g, "");
  if (!/^[+-]?[\d.,]+%?$/.test(s)) return null;
  // "4.870" and "4,870" as thousands; "1,5" as a decimal comma.
  let norm = s.replace(/%$/, "");
  if (/^[+-]?\d{1,3}([.,]\d{3})+$/.test(norm)) norm = norm.replace(/[.,]/g, "");
  else norm = norm.replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const fmt = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 2 });

export function TableWidget({ content }: Props) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;

  const sheets = useMemo(() => {
    if (Array.isArray(d.sheets) && d.sheets.length) {
      return (d.sheets as { name?: string; rows?: Row[] }[]).map((s, i) => ({ name: s.name || `${t("v2.sheet.sheet")} ${i + 1}`, rows: Array.isArray(s.rows) ? s.rows : [] }));
    }
    const rows = Array.isArray(d.rows) ? (d.rows as Row[]) : Array.isArray(d) ? (d as unknown as Row[]) : (SAMPLE_TABLE_DATA as unknown as Row[]);
    return [{ name: typeof d.sheet === "string" ? d.sheet : "", rows }];
  }, [d, t]);
  const sample = !isReal || (!Array.isArray(d.rows) && !Array.isArray(d) && !Array.isArray(d.sheets));
  const [sheetIdx, setSheetIdx] = useState(0);
  const sheet = sheets[Math.min(sheetIdx, sheets.length - 1)];
  const rows: Row[] = sheet.rows;
  const notes = (d.notes && typeof d.notes === "object" ? d.notes : {}) as Record<string, string>;
  const formulas = (d.formulas && typeof d.formulas === "object" ? d.formulas : {}) as Record<string, string>;
  const tones = (d.tones && typeof d.tones === "object" ? d.tones : {}) as Record<string, string>;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [notePos, setNotePos] = useState<{ left: number; top: number } | null>(null);

  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [rows]);
  const numericCols = useMemo(() => new Set(columns.filter((c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== "" && v != null);
    return vals.length > 0 && vals.filter((v) => toNumber(v) != null).length / vals.length >= 0.8;
  })), [columns, rows]);

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);

  const onHeaderClick = useCallback((col: string) => {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(true); }
  }, [sortCol]);

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const na = toNumber(a[sortCol]), nb = toNumber(b[sortCol]);
      const cmp = na != null && nb != null ? na - nb : String(a[sortCol] ?? "").localeCompare(String(b[sortCol] ?? ""), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortCol, sortAsc]);

  const csvContent = useMemo(() => {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [columns.map(esc).join(","), ...sorted.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
  }, [columns, sorted]);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "download", content: csvContent, filename: "table.csv", tip: t("widget.table.download_csv") },
  ], [csvContent, t]);
  const { rendered: headerActions } = useHeaderActions(actions);

  const range = useMemo(() => {
    if (!anchor || !focus) return null;
    return { r0: Math.min(anchor.r, focus.r), r1: Math.max(anchor.r, focus.r), c0: Math.min(anchor.c, focus.c), c1: Math.max(anchor.c, focus.c) };
  }, [anchor, focus]);
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const stats = useMemo(() => {
    if (!range) return null;
    const nums: number[] = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
      const n = toNumber(sorted[r]?.[columns[c]]);
      if (n != null) nums.push(n);
    }
    const ref = range.r0 === range.r1 && range.c0 === range.c1 ? cellRef(range.c0, range.r0) : `${cellRef(range.c0, range.r0)}:${cellRef(range.c1, range.r1)}`;
    return { ref, sum: nums.reduce((a, b) => a + b, 0), avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null, count: nums.length };
  }, [range, sorted, columns]);

  const select = (cell: Cell, extend: boolean) => {
    if (extend && anchor) setFocus(cell);
    else { setAnchor(cell); setFocus(cell); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!focus) return;
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    const next = { r: Math.max(0, Math.min(sorted.length - 1, focus.r + m[0])), c: Math.max(0, Math.min(columns.length - 1, focus.c + m[1])) };
    select(next, e.shiftKey);
  };

  const activeRef = focus ? cellRef(focus.c, focus.r) : "";
  const activeValue = focus ? sorted[focus.r]?.[columns[focus.c]] : "";
  const isTotal = (r: Row) => /^(total|suma|sum)/i.test(String(r[columns[0]] ?? ""));

  // The note opens under its cell, or above it when there is no room below; never off the sheet.
  useLayoutEffect(() => {
    const cell = activeRef && notes[activeRef] ? scrollRef.current?.querySelector<HTMLElement>(`[data-ref="${activeRef}"]`) : null;
    const box = sheetRef.current;
    if (!cell || !box) { setNotePos(null); return; }
    const c = cell.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const w = Math.min(280, b.width * 0.8);
    const h = 96;
    const below = c.bottom - b.top + 6;
    const top = below + h <= b.height ? below : Math.max(0, c.top - b.top - h - 6);
    const left = Math.max(8, Math.min(c.left - b.left, b.width - w - 8));
    setNotePos({ left, top });
  }, [activeRef, notes, sortCol, sortAsc]);

  useShellSubtitle([sheet.name, t("v2.sheet.size", { rows: rows.length, cols: columns.length })].filter(Boolean).join(" · "));
  useShellSample(sample);

  return (
    <BaseWidget>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="table" />
      ) : (
        <div ref={sheetRef} className="kw-sheet">
          {!compact && (
            <div className="kw-formula" aria-live="polite">
              <span className="kw-formula-ref">{activeRef || "—"}</span>
              <span className="kw-formula-fx" aria-hidden="true">fx</span>
              <span className="kw-formula-val">{focus ? (formulas[activeRef] ?? String(activeValue ?? "")) : ""}</span>
            </div>
          )}
          <div ref={scrollRef} className="kw-sheet-scroll scrollbar-thin" tabIndex={0} onKeyDown={onKey} role="grid" aria-label={sheet.name || (t("v2.type.table") as string)}>
            <table className="kw-grid">
              <thead>
                <tr className="kw-letters" aria-hidden="true">
                  <th />
                  {columns.map((_, i) => <th key={i}>{colLetter(i)}</th>)}
                </tr>
                <tr>
                  <th className="kw-rownum">1</th>
                  {columns.map((col) => (
                    <th key={col} scope="col" className={numericCols.has(col) ? "is-num" : ""} aria-sort={sortCol === col ? (sortAsc ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => onHeaderClick(col)}>
                        {col}{sortCol === col ? (sortAsc ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, r) => (
                  <tr key={r} className={isTotal(row) ? "is-total" : ""}>
                    <th className="kw-rownum" scope="row">{r + 2}</th>
                    {columns.map((col, c) => {
                      const ref = cellRef(c, r);
                      const note = notes[ref];
                      const v = row[col];
                      const n = numericCols.has(col) ? toNumber(v) : null;
                      const tone = typeof v === "string" ? tones[v] : undefined;
                      const pos = n != null && n > 0 && typeof v === "string" && v.trim().startsWith("+");
                      return (
                        <td
                          key={col}
                          data-ref={ref}
                          role="gridcell"
                          aria-selected={inRange(r, c)}
                          className={`${numericCols.has(col) ? "is-num" : ""} ${n != null && n < 0 ? "is-neg" : ""} ${pos ? "is-pos" : ""} ${tone ? `is-tone-${tone}` : ""} ${focus && focus.r === r && focus.c === c ? "is-focus" : ""} ${formulas[ref] ? "is-formula" : ""}`}
                          onMouseDown={(e) => select({ r, c }, e.shiftKey)}
                          onMouseEnter={(e) => { if (e.buttons === 1 && anchor) setFocus({ r, c }); }}
                          title={note ? `${t("v2.sheet.note")}: ${note}` : undefined}
                        >
                          {String(v ?? "")}
                          {note && <span className="kw-note-mark" aria-label={t("v2.sheet.note") as string} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {focus && notes[activeRef] && !compact && notePos && (
            <div className="kw-note-card" role="note" style={notePos}>
              <MessageSquare size={13} aria-hidden="true" /><strong>{t("v2.sheet.kali_note", { ref: activeRef })}</strong>
              <p>{notes[activeRef]}</p>
            </div>
          )}
          {sheets.length > 1 && (
            <div className="kw-sheet-tabs" role="tablist">
              {sheets.map((s, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === sheetIdx} className="kw-tab" onClick={() => { setSheetIdx(i); setAnchor(null); setFocus(null); }}>{s.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <WidgetFooter>
        {stats ? (
          <>
            <span className="v2-foot-item">{t("v2.sheet.selection", { ref: stats.ref })}</span>
            {stats.count > 0 && <span className="v2-foot-item">{t("v2.sheet.sum", { value: fmt(stats.sum) })}</span>}
            {stats.avg != null && stats.count > 1 && <span className="v2-foot-item">{t("v2.sheet.avg", { value: fmt(stats.avg) })}</span>}
          </>
        ) : (
          <span className="v2-foot-item">{t("v2.sheet.size", { rows: rows.length, cols: columns.length })}</span>
        )}
      </WidgetFooter>
    </BaseWidget>
  );
}
