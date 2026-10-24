/**
 * stage/v2/CommandPalette.tsx — Ctrl+K: go to any window or group, change mode, open a panel.
 *
 * A combobox over one flat list of commands; typing filters by every word, arrows move, Enter
 * runs, Esc closes. Windows of other groups open their group first.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface PaletteCommand {
  id: string;
  label: string;
  section: string;
  icon?: ReactNode;
  kbd?: string;
  /** Extra words that match (type, group). */
  keywords?: string;
  run: () => void;
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const hay = `${c.label} ${c.section} ${c.keywords ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterCommands(commands, q), [commands, q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" }); }, [i]);

  const run = (c: PaletteCommand | undefined) => { if (!c) return; onClose(); c.run(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(shown[i]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  let lastSection = "";
  return (
    <div className="v2-palette-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v2-palette v2-enter" role="dialog" aria-modal="true" aria-label={t("v2.menu.palette") as string}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("v2.palette.placeholder") as string}
          role="combobox"
          aria-expanded="true"
          aria-controls="v2-palette-list"
          aria-activedescendant={shown[i] ? `v2-cmd-${shown[i].id}` : undefined}
          aria-label={t("v2.palette.placeholder") as string}
        />
        <ul id="v2-palette-list" ref={listRef} role="listbox">
          {shown.length === 0 && <li className="v2-pop-title" style={{ textTransform: "none" }}>{t("v2.overview.no_match")}</li>}
          {shown.map((c, idx) => {
            const head = c.section !== lastSection ? c.section : null;
            lastSection = c.section;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="v2-pop-title" role="presentation">{head}</div>}
                <div
                  id={`v2-cmd-${c.id}`}
                  role="option"
                  aria-selected={idx === i}
                  data-index={idx}
                  onPointerMove={() => setI(idx)}
                  onClick={() => run(c)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14, background: idx === i ? "color-mix(in srgb, var(--accent) 14%, transparent)" : undefined }}
                >
                  {c.icon}
                  <span className="truncate">{c.label}</span>
                  {c.kbd && <span className="v2-kbd" style={{ marginLeft: "auto" }}>{c.kbd}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
