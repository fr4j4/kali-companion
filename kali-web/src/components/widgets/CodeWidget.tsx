/**
 * CodeWidget — read and follow what Kali writes.
 *
 * One file, or a small project: `files: [{ path, code, language?, status?: "M" | "A" | "D",
 * changed?: number[] }]` shows a file tree (with change marks) and a tab per open file. Changed
 * lines get a bar at the edge of the gutter; while Kali writes, her cursor is on the last line.
 * The footer says the language, the line count and the file.
 */

import { useMemo, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { File as FileIcon, Folder } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { CodeViewer } from "./base/CodeViewer";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_CODE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
}

export interface CodeFile { path: string; code: string; language?: string; status?: "M" | "A" | "D"; changed?: number[] }

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", py: "python", rs: "rust",
  css: "css", scss: "scss", html: "html", json: "json", md: "markdown", sh: "bash", go: "go", java: "java", c: "c",
  cpp: "cpp", h: "c", rb: "ruby", php: "php", yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql", svg: "xml", xml: "xml",
};
export const langOf = (path: string, fallback = "") => EXT_LANG[path.split(".").pop()?.toLowerCase() ?? ""] ?? fallback;

/** Files of a code artifact: the `files` list, or the single `code` as one file. */
export function codeFiles(d: Record<string, unknown> | string, fallbackTitle = ""): { files: CodeFile[]; sample: boolean } {
  if (typeof d === "string") return { files: [{ path: fallbackTitle || "code", code: d }], sample: false };
  if (Array.isArray(d.files) && d.files.length) {
    const files = (d.files as Record<string, unknown>[])
      .filter((f) => f && typeof f.path === "string")
      .map((f): CodeFile => ({
        path: String(f.path),
        code: typeof f.code === "string" ? f.code : typeof f.content === "string" ? (f.content as string) : "",
        language: typeof f.language === "string" ? f.language : undefined,
        status: f.status === "M" || f.status === "A" || f.status === "D" ? (f.status as CodeFile["status"]) : undefined,
        changed: Array.isArray(f.changed) ? (f.changed as unknown[]).filter((n): n is number => typeof n === "number") : undefined,
      }));
    if (files.length) return { files, sample: false };
  }
  if (typeof d.code === "string") {
    return {
      files: [{ path: (typeof d.filename === "string" && d.filename) || (typeof d.path === "string" && d.path) || fallbackTitle || "code", code: d.code, language: typeof d.language === "string" ? d.language : undefined, changed: Array.isArray(d.changed) ? (d.changed as number[]) : undefined }],
      sample: false,
    };
  }
  return { files: [{ path: "example.ts", code: SAMPLE_CODE, language: "typescript" }], sample: true };
}

/** Folder tree rows (depth-first) from file paths. */
export function treeRows(paths: string[]): { key: string; name: string; depth: number; dir: boolean; path?: string }[] {
  const rows: { key: string; name: string; depth: number; dir: boolean; path?: string }[] = [];
  const seen = new Set<string>();
  for (const p of [...paths].sort((a, b) => a.localeCompare(b))) {
    const parts = p.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join("/");
      if (!seen.has(key)) { seen.add(key); rows.push({ key, name: parts[i], depth: i, dir: true }); }
    }
    rows.push({ key: p, name: parts[parts.length - 1] ?? p, depth: Math.max(0, parts.length - 1), dir: false, path: p });
  }
  return rows;
}

export function CodeWidget({ content }: Props) {
  const { t } = useTranslation();
  const event = content as ArtifactEvent | undefined;
  const isStreaming = event?.phase === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);
  const { compact } = useShell();

  const { data, title } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown> | string;
  const { files, sample } = useMemo(() => codeFiles(d, title), [d, title]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const multi = files.length > 1;

  // Follow the file Kali is writing (the last one that changed), unless you picked another.
  const lastWritten = files[files.length - 1]?.path;
  useEffect(() => { if (isStreaming && lastWritten) setActivePath(lastWritten); }, [isStreaming, lastWritten]);
  const file = files.find((f) => f.path === activePath) ?? files.find((f) => f.changed?.length) ?? files.find((f) => f.status === "M" || f.status === "A") ?? files[0];
  useEffect(() => { if (file) setOpenPaths((p) => (p.includes(file.path) ? p : [...p, file.path].slice(-6))); }, [file?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const lang = file.language || langOf(file.path, typeof d === "object" && typeof d.language === "string" ? d.language : "");
  const lines = useMemo(() => file.code.split("\n").length, [file.code]);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => file.code, tip: t("widget.code.copy") },
  ], [file.code, t]);
  const { rendered: headerActions } = useHeaderActions(actions);

  // The language and line count are in the footer; the subtitle only names the file when it adds something.
  useShellSubtitle(multi ? file.path : file.path !== "code" ? file.path : null);
  useShellSample(sample);

  useEffect(() => {
    if (isStreaming && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [file.code, isStreaming]);

  const tree = useMemo(() => (multi ? treeRows(files.map((f) => f.path)) : []), [multi, files]);

  return (
    <BaseWidget content={content} className="overflow-hidden">
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      <div className="kw-code">
        {multi && !compact && (
          <nav className="kw-tree scrollbar-thin" aria-label={t("v2.code.files") as string}>
            <div className="kw-side-title">{t("v2.code.files")}</div>
            {tree.map((r) => {
              const f = r.path ? files.find((x) => x.path === r.path) : undefined;
              return r.dir ? (
                <div key={r.key} className="kw-tree-row is-dir" style={{ paddingLeft: 10 + r.depth * 14 }}><Folder size={14} aria-hidden="true" />{r.name}</div>
              ) : (
                <button
                  key={r.key}
                  type="button"
                  className="kw-tree-row"
                  aria-current={f?.path === file.path || undefined}
                  style={{ paddingLeft: 10 + r.depth * 14 }}
                  onClick={() => setActivePath(r.path!)}
                >
                  <FileIcon size={14} aria-hidden="true" />
                  <span className="truncate">{r.name}</span>
                  {f?.status && <span className={`kw-mark is-${f.status}`} title={t(`v2.code.status_${f.status}`) as string}>{f.status}</span>}
                </button>
              );
            })}
          </nav>
        )}
        <div className="kw-code-main">
          {multi && (
            <div className="kw-tabs" role="tablist">
              {openPaths.map((p) => {
                const f = files.find((x) => x.path === p);
                if (!f) return null;
                return (
                  <button key={p} type="button" role="tab" aria-selected={p === file.path} className="kw-tab" onClick={() => setActivePath(p)} title={p}>
                    {p.split("/").pop()}
                    {isStreaming && p === lastWritten && <span className="kw-dot is-live" aria-label={t("v2.status.writing") as string} />}
                  </button>
                );
              })}
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin min-h-0">
            <CodeViewer code={file.code} language={lang} isStreaming={isStreaming && file.path === lastWritten} changed={file.changed} />
          </div>
        </div>
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{lang || t("v2.type.code")}</span>
        <span className="v2-foot-item">{t("widget.code.lines", { count: lines })}</span>
        {multi && <span className="v2-foot-item">{t("v2.code.n_files", { count: files.length })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
