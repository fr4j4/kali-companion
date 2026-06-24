import { useMemo } from "react";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { parseContent } from "./base/DataWidget";

const SAMPLE_DIFF = `--- a/src/main.rs
+++ b/src/main.rs
@@ -1,10 +1,11 @@
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

export function DiffWidget({ content }: Props) {
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const diffText = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.content && typeof d.content === "string") return d.content;
    return SAMPLE_DIFF;
  }, [d]);

  const lines = useMemo(() => diffText.split("\n"), [diffText]);
  const addCount = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const delCount = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <ScrollableWidget searchable={false}>
      <pre className="p-3 text-xs font-mono leading-5">
        {lines.map((line, i) => {
          let className = "";
          if (line.startsWith("---") || line.startsWith("+++")) className = "text-accent font-medium";
          else if (line.startsWith("+")) className = "diff-add px-2 -mx-2";
          else if (line.startsWith("-")) className = "diff-del px-2 -mx-2";
          else if (line.startsWith("@")) className = "text-accent/60";
          return (
            <div key={i} className={className}>
              <span className="text-muted/30 w-6 inline-block text-right mr-2">{i + 1}</span>
              {line}
            </div>
          );
        })}
      </pre>
      <div className="px-3 py-1.5 border-t border-white/5 flex items-center gap-3 text-[10px] text-muted/60">
        <span className="text-ok">+{addCount}</span>
        <span className="text-err">-{delCount}</span>
      </div>
    </ScrollableWidget>
  );
}
