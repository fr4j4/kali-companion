import { useMemo, useState, useCallback } from "react";
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
  const { data } = useMemo(() => parseContent(content), [content]);
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
  ], [jsonStr, expandAll, collapseAll]);

  const { rendered: headerActions } = useHeaderActions(actions);

  return (
    <ScrollableWidget searchable={false} content={content}>
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="json" />
      ) : (
        <div className="p-3 text-xs font-mono leading-5">
          {renderValue(parsed, "root", 0, expandedPaths, togglePath)}
        </div>
      )}
    </ScrollableWidget>
  );
}

function renderValue(
  val: unknown,
  path: string,
  depth: number,
  expanded: Set<string>,
  onToggle: (path: string) => void,
): JSX.Element {
  const indent = { paddingLeft: `${depth * 16}px` };

  if (val === null) {
    return <div style={indent}><span className="json-null">null</span></div>;
  }
  if (typeof val === "boolean") {
    return <div style={indent}><span className="json-bool">{String(val)}</span></div>;
  }
  if (typeof val === "number") {
    return <div style={indent}><span className="json-num">{val}</span></div>;
  }
  if (typeof val === "string") {
    return <div style={indent}><span className="json-string">"{val}"</span></div>;
  }
  if (Array.isArray(val)) {
    const isOpen = expanded.has(path);
    return (
      <div>
        <div style={indent}>
          <span className={`json-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(path)} />
          <span className="json-key">Array[{val.length}]</span>
        </div>
        {isOpen && val.map((item, i) => (
          <div key={i}>
            {renderValue(item, `${path}[${i}]`, depth + 1, expanded, onToggle)}
          </div>
        ))}
        {isOpen && <div style={indent}><span className="text-muted">]</span></div>}
      </div>
    );
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    const isOpen = expanded.has(path);
    return (
      <div>
        <div style={indent}>
          <span className={`json-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(path)} />
          {depth === 0 ? null : <span className="json-key">{'{...}'}</span>}
        </div>
        {isOpen && entries.map(([key, value]) => (
          <div key={key} style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
            <span className="json-key">{key}</span>
            <span className="text-muted">: </span>
            {typeof value === "object" && value !== null
              ? renderValue(value, `${path}.${key}`, depth + 1, expanded, onToggle)
              : <span>{String(value)}</span>
            }
          </div>
        ))}
      </div>
    );
  }
  return <div style={indent}>{String(val)}</div>;
}
