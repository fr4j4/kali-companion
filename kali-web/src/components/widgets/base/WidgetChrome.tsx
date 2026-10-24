/**
 * base/WidgetChrome.tsx — A widget's toolbar and footer, wherever the widget is shown.
 *
 * Inside the neural canvas frame (ArtifactShell) the buttons go to the window header and the
 * facts to the window footer, as the design asks; anywhere else (the old canvas, the detached
 * window) they keep their own row at the top or bottom of the widget.
 */

import type { ReactNode } from "react";
import { ShellActions, ShellFooter, useInShell } from "../../../stage/v2/shell";

export function WidgetToolbar({ children }: { children: ReactNode }) {
  const inShell = useInShell();
  if (inShell) return <ShellActions fallback={false}>{children}</ShellActions>;
  return (
    <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-fg/5 shrink-0">
      {children}
    </div>
  );
}

export function WidgetFooter({ children }: { children: ReactNode }) {
  const inShell = useInShell();
  if (inShell) return <ShellFooter>{children}</ShellFooter>;
  return (
    <div className="shrink-0 px-3 py-1.5 border-t border-fg/5 flex items-center gap-3 text-[10px] text-muted/60">
      {children}
    </div>
  );
}
