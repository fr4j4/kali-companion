/**
 * DiffWidget — review what Kali changed before it stays.
 *
 * A unified diff becomes a list of files with their +/− counts and, for the chosen file, the lines
 * with both line numbers, the sign, and Kali's notes under the line they talk about. The content is
 * the diff text, or `{ diff, title?, branch?, notes?: [{ file?, line, text, side? }] }`. Approving or
 * asking for an adjustment answers Kali in the conversation.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseContent } from "./base/DataWidget";
import { BaseWidget } from "./base/BaseWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useStage } from "../../stage/StageProvider";
import { GitBranch } from "lucide-react";

const SAMPLE_DIFF = `--- a/src/main.rs
+++ b/src/main.rs
@@ -1,7 +1,7 @@
 fn process(data: &[u8]) -> Result<()> {
     let mut buffer = Vec::new();
-    for chunk in data.chunks(64) {
+    for chunk in data.chunks(128) {
         buffer.extend_from_slice(chunk);
     }
-    Ok(())
+    Ok(buffer)
 }
`;

interface Props {
  content?: unknown;
}

export interface DiffLine { kind: " " | "+" | "-"; old: number | null; new: number | null; text: string }
export interface DiffFile { path: string; add: number; del: number; hunks: { header: string; lines: DiffLine[] }[] }
export interface DiffNote { file?: string; line: number; text: string; side?: "old" | "new" }

/** Parse a unified diff (one or several files). Text without file headers is one unnamed file. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file = null as DiffFile | null;
  let hunk = null as DiffFile["hunks"][number] | null;
  let o = 0, n = 0;
  let afterMinus = false;
  const ensureFile = () => {
    if (!file) { file = { path: "", add: 0, del: 0, hunks: [] }; files.push(file); }
    return file;
  };
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) { file = null; hunk = null; const m = / b\/(.+)$/.exec(raw); if (m) { ensureFile().path = m[1]; } continue; }
    // Inside a hunk, "--- x" is a removed "-- x" line unless it looks like a file header.
    if (raw.startsWith("--- ") && (!hunk || /^--- (a\/|\/dev\/null|\S+\t)/.test(raw))) {
      afterMinus = true;
      if (!file || file.hunks.length) { file = null; ensureFile(); }
      hunk = null;
      const p = raw.slice(4).replace(/^a\//, "").trim();
      if (p !== "/dev/null" && !file!.path) file!.path = p;
      continue;
    }
    if (raw.startsWith("+++ ") && afterMinus) {
      afterMinus = false;
      const p = raw.slice(4).replace(/^b\//, "").trim();
      if (p !== "/dev/null") ensureFile().path = p;
      continue;
    }
    afterMinus = false;
    if (/^(index |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(raw)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) {
      o = Number(h[1]); n = Number(h[2]);
      hunk = { header: h[3].trim(), lines: [] };
      ensureFile().hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (raw === "") continue;
      hunk = { header: "", lines: [] };
      ensureFile().hunks.push(hunk);
      o = 1; n = 1;
    }
    const f = ensureFile();
    if (raw.startsWith("+")) { hunk.lines.push({ kind: "+", old: null, new: n++, text: raw.slice(1) }); f.add++; }
    else if (raw.startsWith("-")) { hunk.lines.push({ kind: "-", old: o++, new: null, text: raw.slice(1) }); f.del++; }
    else if (raw.startsWith("\\")) continue;
    else hunk.lines.push({ kind: " ", old: o++, new: n++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
  }
  // Drop a trailing empty context line from the final newline.
  for (const f of files) {
    const last = f.hunks[f.hunks.length - 1]?.lines;
    if (last && last.length && last[last.length - 1].kind === " " && last[last.length - 1].text === "") last.pop();
  }
  return files.filter((f) => f.hunks.some((hk) => hk.lines.length));
}

export function DiffWidget({ content }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { compact } = useShell();
  const { data, title, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const text = typeof data === "string" ? data : typeof d.diff === "string" ? d.diff : typeof d.content === "string" ? d.content : "";
  const sample = !isReal || !text;
  const files = useMemo(() => parseUnifiedDiff(text || SAMPLE_DIFF), [text]);
  const notes = useMemo(() => (Array.isArray(d.notes) ? (d.notes as DiffNote[]).filter((x) => x && typeof x.line === "number" && typeof x.text === "string") : []), [d.notes]);
  const branch = typeof d.branch === "string" ? d.branch : "";
  const heading = (typeof d.title === "string" && d.title) || title;

  const [sel, setSel] = useState(0);
  const file = files[Math.min(sel, files.length - 1)];
  const add = files.reduce((a, f) => a + f.add, 0);
  const del = files.reduce((a, f) => a + f.del, 0);
  const [answered, setAnswered] = useState<"approved" | "adjust" | null>(null);
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");

  useShellSubtitle(branch || file?.path || null);
  useShellSample(sample);

  const approve = () => {
    chat.send(t("v2.diff.approve_msg", { title: heading || file?.path || "" }));
    setAnswered("approved");
  };
  const sendAdjust = () => {
    if (!ask.trim()) return;
    chat.send(t("v2.diff.adjust_msg", { title: heading || file?.path || "", text: ask.trim() }));
    setAsking(false); setAsk(""); setAnswered("adjust");
  };

  // A note speaks of a line of the new version; `side: "old"` points at a removed line instead.
  const notesFor = (ln: DiffLine) => notes.filter((nt) => (!nt.file || nt.file === file.path || files.length === 1)
    && (nt.side === "old" ? ln.kind === "-" && ln.old === nt.line : ln.new === nt.line));

  return (
    <BaseWidget>
      {!compact && (
        <div className="kw-review-bar">
          <div className="kw-review-title">
            <strong>{heading || t("v2.diff.title")}</strong>
            <span className="kw-review-count">
              {t("v2.code.n_files", { count: files.length })} · <span className="text-ok">+{add}</span> <span className="text-err">−{del}</span>
            </span>
          </div>
          {isReal && (
            answered ? (
              <span className={`kw-review-done ${answered === "approved" ? "is-ok" : ""}`}>{t(answered === "approved" ? "v2.diff.approved" : "v2.diff.adjust_sent")}</span>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="v2-btn" onClick={() => setAsking((v) => !v)} aria-expanded={asking}>{t("v2.diff.adjust")}</button>
                <button type="button" className="v2-btn is-primary" onClick={approve}>{t("v2.diff.approve")}</button>
              </div>
            )
          )}
        </div>
      )}
      {asking && (
        <form className="kw-review-ask" onSubmit={(e) => { e.preventDefault(); sendAdjust(); }}>
          <input autoFocus value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t("v2.diff.adjust_placeholder") as string} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }} />
          <button type="submit" className="v2-btn is-primary" disabled={!ask.trim()}>{t("v2.diff.send")}</button>
        </form>
      )}
      <div className="kw-review">
        {files.length > 1 && !compact && (
          <nav className="kw-review-files scrollbar-thin" aria-label={t("v2.code.files") as string}>
            {files.map((f, i) => (
              <button key={i} type="button" className="kw-review-file" aria-current={i === sel || undefined} onClick={() => setSel(i)} title={f.path}>
                <span className="truncate">{f.path.split("/").pop() || f.path}</span>
                <span className="kw-mono text-ok">+{f.add}</span>
                <span className="kw-mono text-err">−{f.del}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="kw-diff scrollbar-thin" role="table" aria-label={file?.path || (t("v2.type.diff") as string)}>
          {file?.hunks.map((h, hi) => (
            <div key={hi} role="rowgroup">
              {(hi > 0 || h.header) && <div className="kw-diff-hunk" role="row">{h.header || "⋯"}</div>}
              {h.lines.map((ln, li) => (
                <div key={li}>
                  <div className={`kw-diff-line ${ln.kind === "+" ? "is-add" : ln.kind === "-" ? "is-del" : ""}`} role="row">
                    <span className="kw-diff-num" role="cell">{ln.old ?? ""}</span>
                    <span className="kw-diff-num" role="cell">{ln.new ?? ""}</span>
                    <span className="kw-diff-sign" role="cell" aria-label={ln.kind === "+" ? (t("v2.diff.added") as string) : ln.kind === "-" ? (t("v2.diff.removed") as string) : undefined}>{ln.kind === " " ? "" : ln.kind === "-" ? "−" : "+"}</span>
                    <span className="kw-diff-text" role="cell">{ln.text}</span>
                  </div>
                  {notesFor(ln).map((nt, ni) => (
                    <div key={ni} className="kw-diff-note" role="note">
                      <strong>{t("v2.diff.kali_line", { line: nt.line })}</strong>
                      <p>{nt.text}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <WidgetFooter>
        {branch && <span className="v2-foot-item"><GitBranch size={12} aria-hidden="true" />{branch}</span>}
        <span className="v2-foot-item">{t("v2.code.n_files", { count: files.length })}</span>
        {compact && <span className="v2-foot-item"><span className="text-ok">+{add}</span> <span className="text-err">−{del}</span></span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
