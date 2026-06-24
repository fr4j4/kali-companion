import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { SAMPLE_TERMINAL_OUTPUT } from "./utils/sampleData";

type Line = { type: string; text: string };

function makeFakeCommands(t: (key: string) => string): Record<string, string[]> {
  return {
    ls: ["src/", "tests/", "Cargo.toml", "README.md"],
    pwd: ["/home/user/project"],
    cargo: ["Usage: cargo build | cargo test | cargo clippy"],
    help: [t("widget.terminal.help")],
  };
}

interface Props {
  content?: unknown;
}

export function TerminalWidget(_props: Props) {
  const { t } = useTranslation();
  const FAKE_COMMANDS = makeFakeCommands(t);
  const [lines, setLines] = useState<Line[]>(SAMPLE_TERMINAL_OUTPUT);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const execute = (cmd: string) => {
    const trimmed = cmd.trim();
    setLines((prev) => [...prev, { type: "prompt", text: `$ ${trimmed}` }]);
    if (trimmed === "clear") {
      setLines([]);
      return;
    }
    const result = FAKE_COMMANDS[trimmed];
    if (result) {
      result.forEach((r) => setLines((prev) => [...prev, { type: "out", text: r }]));
    } else if (trimmed) {
      setLines((prev) => [...prev, { type: "err", text: `command not found: ${trimmed}` }]);
    }
    setHistory((prev) => [...prev, trimmed]);
    setHistIdx(-1);
    setInput("");
  };

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      execute(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx >= 0) {
        const idx = histIdx + 1;
        if (idx >= history.length) {
          setHistIdx(-1);
          setInput("");
        } else {
          setHistIdx(idx);
          setInput(history[idx]);
        }
      }
    }
  }, [execute, history, histIdx]);

  return (
    <ScrollableWidget searchable={false}>
      <div ref={scrollRef} className="p-3">
        {lines.map((line, i) => (
          <div key={i} className={`term-line ${line.type === "prompt" ? "term-prompt" : line.type === "err" ? "term-err" : line.type === "ok" ? "term-ok" : line.type === "warn" ? "term-warn" : "term-out"}`}>
            {line.text}
          </div>
        ))}
        <div className="flex items-center">
          <span className="term-line term-prompt shrink-0">$ </span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="term-input"
            autoFocus
          />
        </div>
      </div>
    </ScrollableWidget>
  );
}
