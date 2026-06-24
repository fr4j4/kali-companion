import { useMemo, type ReactNode } from "react";
import { useClipboard } from "./useClipboard";
import { useDownload } from "./useDownload";

export type HeaderAction =
  | { type: "copy"; getContent: () => string; tip: string }
  | { type: "download"; content: string; filename: string; tip: string }
  | { type: "custom"; icon: ReactNode; onClick: () => void; tip: string };

export function useHeaderActions(actions: HeaderAction[]) {
  const { copy } = useClipboard();
  const { download } = useDownload();

  const rendered = useMemo(() => {
    return actions.map((a, i) => {
      if (a.type === "copy") {
        return (
          <button
            key={i}
            onClick={() => copy(a.getContent())}
            className="tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center"
            title={a.tip}
            aria-label={a.tip}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        );
      }
      if (a.type === "download") {
        return (
          <button
            key={i}
            onClick={() => download(a.content, a.filename)}
            className="tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center"
            title={a.tip}
            aria-label={a.tip}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </button>
        );
      }
      if (a.type === "custom") {
        return (
          <button
            key={i}
            onClick={a.onClick}
            className="tooltip w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-accent transition flex items-center justify-center"
            title={a.tip}
            aria-label={a.tip}
          >
            {a.icon}
          </button>
        );
      }
      return null;
    });
  }, [actions, copy, download]);

  return { rendered };
}
