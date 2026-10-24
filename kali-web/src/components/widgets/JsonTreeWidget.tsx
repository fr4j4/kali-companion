/**
 * JsonTreeWidget — structured data as a tree you can fold: keys, types in colour, item counts on
 * folded branches, and the path of the chosen value in the footer (click a row to pick it, copy
 * the path from there).
 */

import { useMemo, useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useTranslation } from "react-i18next";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_JSON } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function JsonTreeWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as unknown;
  const jsonStr = useMemo(() => {
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "content" in (d as Record<string, unknown>)) {
      const c = (d as Record<string, unknown>).content;
      if (typeof c === "string") return c;
    }
    // parseContent may return an already-parsed JSON object (when
    // event.content is valid JSON). Stringify it so we can re-parse
    // into the tree below.
    if (d !== null && typeof d === "object") return JSON.stringify(d, null, 2);
    return SAMPLE_JSON;
  }, [d]);

  const parsed = useMemo(() => {
    try { return JSON.parse(jsonStr); }
    catch { return { error: "Invalid JSON" }; }
  }, [jsonStr]);
  const [picked, setPicked] = useState<string>("");
  const keyCount = useMemo(() => {
    let n = 0;
    const walk = (v: unknown) => { if (v && typeof v === "object") for (const k of Object.keys(v as object)) { n++; walk((v as Record<string, unknown>)[k]); } };
    walk(parsed);
    return n;
  }, [parsed]);
  useShellSubtitle(Array.isArray(parsed) ? t("v2.json.items", { count: parsed.length }) : t("v2.json.keys", { count: keyCount }));
  useShellSample(!isReal);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["root"]));

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    const walk = (obj: unknown, path: string) => {
      all.add(path);
      if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj as Record<string, unknown>)) {
          walk((obj as Record<string, unknown>)[key], `${path}.${key}`);
        }
      }
    };
    walk(parsed, "root");
    setExpandedPaths(all);
  }, [parsed]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set(["root"]));
  }, []);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => jsonStr, tip: t("widget.json.copy") },
    { type: "custom", icon: '\u2191', onClick: expandAll, tip: t("widget.json.expand_all") },
    { type: "custom", icon: '\u2193', onClick: collapseAll, tip: t("widget.json.collapse_all") },
  ], [jsonStr, expandAll, collapseAll, t]);

  const { rendered: headerActions } = useHeaderActions(actions);

  return (
    <ScrollableWidget searchable={false} content={content}>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="json" />
      ) : (
        <div className="kw-json" role="tree">
          <JsonNode name={null} val={parsed} path="root" depth={0} expanded={expandedPaths} onToggle={togglePath} picked={picked} onPick={setPicked} />
        </div>
      )}
      <WidgetFooter>
        <span className="v2-foot-item kw-mono">{picked ? jsonPath(picked) : t("v2.json.keys", { count: keyCount })}</span>
      </WidgetFooter>
    </ScrollableWidget>
  );
}

/** "root.a[0].b" → "$.a[0].b" */
export const jsonPath = (p: string) => p.replace(/^root/, "$");

function Scalar({ val }: { val: unknown }) {
  if (val === null) return <span className="kw-json-null">null</span>;
  if (typeof val === "boolean") return <span className="kw-json-bool">{String(val)}</span>;
  if (typeof val === "number") return <span className="kw-json-num">{val}</span>;
  return <span className="kw-json-str">"{String(val)}"</span>;
}

function JsonNode({ name, val, path, depth, expanded, onToggle, picked, onPick }: {
  name: string | null; val: unknown; path: string; depth: number; expanded: Set<string>;
  onToggle: (path: string) => void; picked: string; onPick: (path: string) => void;
}) {
  const branch = val !== null && typeof val === "object";
  const open = expanded.has(path);
  const entries = branch ? (Array.isArray(val) ? val.map((v, i) => [String(i), v] as const) : Object.entries(val as Record<string, unknown>)) : [];
  const childPath = (k: string) => (Array.isArray(val) ? `${path}[${k}]` : `${path}.${k}`);
  return (
    <div role="treeitem" aria-expanded={branch ? open : undefined} aria-selected={picked === path}>
      <div
        className={`kw-json-row ${picked === path ? "is-picked" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => { onPick(path); if (branch) onToggle(path); }}
      >
        {branch ? <ChevronRight size={12} className={`kw-json-chev ${open ? "is-open" : ""}`} aria-hidden="true" /> : <span className="kw-json-chev" />}
        {name != null && <><span className="kw-json-key">{name}</span><span className="kw-json-colon">:</span></>}
        {branch
          ? <span className="kw-json-meta">{Array.isArray(val) ? `[${entries.length}]` : `{${entries.length}}`}</span>
          : <Scalar val={val} />}
      </div>
      {branch && open && entries.map(([k, v]) => (
        <JsonNode key={k} name={Array.isArray(val) ? null : k} val={v} path={childPath(k)} depth={depth + 1} expanded={expanded} onToggle={onToggle} picked={picked} onPick={onPick} />
      ))}
    </div>
  );
}
