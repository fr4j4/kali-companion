interface Props {
  content: string;
}

function getDiffStyle(line: string): React.CSSProperties {
  if (line.startsWith("+")) return { background: "rgba(74, 222, 128, 0.15)" };
  if (line.startsWith("-")) return { background: "rgba(248, 113, 113, 0.15)" };
  return {};
}

function getDiffPrefixClass(line: string): string {
  if (line.startsWith("@@")) return "text-accent font-semibold";
  return "";
}

export function DiffArtifact({ content }: Props) {
  const lines = content.split("\n");
  return (
    <pre className="font-mono text-xs p-3 m-0 overflow-x-auto whitespace-pre">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-0" style={getDiffStyle(line)}>
          <span className={`w-5 text-muted text-center select-none shrink-0 ${getDiffPrefixClass(line)}`}>{line[0] ?? " "}</span>
          <span>{line.slice(1)}</span>
        </div>
      ))}
    </pre>
  );
}
