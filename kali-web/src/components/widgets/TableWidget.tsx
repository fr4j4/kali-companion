import { useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_TABLE_DATA } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function TableWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const rows = useMemo(() => {
    if (d.rows && Array.isArray(d.rows)) return d.rows;
    if (Array.isArray(d)) return d;
    return SAMPLE_TABLE_DATA;
  }, [d]) as Record<string, unknown>[];

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const onHeaderClick = useCallback((col: string) => {
    if (sortCol === col) {
      setSortAsc((a) => !a);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  }, [sortCol]);

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const va = String(a[sortCol] ?? "");
      const vb = String(b[sortCol] ?? "");
      const cmp = va.localeCompare(vb, undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortCol, sortAsc]);

  const csvContent = useMemo(() => {
    const header = columns.join(",");
    const body = sorted.map((r) => columns.map((c) => String(r[c] ?? "")).join(",")).join("\n");
    return header + "\n" + body;
  }, [columns, sorted]);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "download", content: csvContent, filename: "table.csv", tip: t("widget.table.download_csv") },
  ], [csvContent]);

  const { rendered: headerActions } = useHeaderActions(actions);

  return (
    <BaseWidget>
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="table" />
      ) : (
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                {columns.map((col) => (
                  <th
                    key={col}
                    onClick={() => onHeaderClick(col)}
                    className="text-left px-3 py-2 text-muted font-medium cursor-pointer hover:text-fg transition whitespace-nowrap"
                  >
                    {col} {sortCol === col ? (sortAsc ? '\u2191' : '\u2193') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i} className="border-b border-white/5 last:border-none hover:bg-white/[0.02]">
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5 text-fg whitespace-nowrap">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BaseWidget>
  );
}
