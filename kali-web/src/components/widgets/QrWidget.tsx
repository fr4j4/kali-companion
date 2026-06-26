import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

function generateQRMatrix(text: string): boolean[][] {
  const size = 11;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Position markers (fixed blocks)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      matrix[i][j] = true;
      matrix[i][size - 1 - j] = true;
      matrix[size - 1 - i][j] = true;
    }
  }

  // Inner position marker cleanup
  for (let i = 1; i < 4; i++) {
    for (let j = 1; j < 4; j++) {
      matrix[i][j] = false;
      matrix[i][size - 1 - j] = false;
      matrix[size - 1 - i][j] = false;
    }
  }
  matrix[2][2] = true;
  matrix[2][size - 3] = true;
  matrix[size - 3][2] = true;

  // Data blocks based on text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  let seed = Math.abs(hash);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (matrix[i][j]) continue;
      seed = (seed * 16807) % 2147483647;
      matrix[i][j] = seed % 3 !== 0;
    }
  }

  return matrix;
}

export function QrWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const [text, setText] = useState((d.text as string) || (d.url as string) || "Hello World");

  const matrix = useMemo(() => generateQRMatrix(text), [text]);

  const size = matrix.length;
  const cellSize = 14;

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        <svg viewBox={`0 0 ${size * cellSize} ${size * cellSize}`} className="w-full max-w-[200px] mx-auto">
          <rect width={size * cellSize} height={size * cellSize} fill="white" rx="4" />
          {matrix.map((row, y) =>
            row.map((cell, x) =>
              cell ? <rect key={`${x}-${y}`} x={x * cellSize} y={y * cellSize} width={cellSize} height={cellSize} fill="black" /> : null
            )
          )}
        </svg>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("widget.qr.placeholder")}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-fg placeholder:text-muted outline-none focus:border-accent/40 transition text-center"
        />
      </div>
    </BaseWidget>
  );
}
