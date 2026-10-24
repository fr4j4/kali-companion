/**
 * NotesWidget — notes, reminders, short lists and saved links as cards. A search field and filters
 * (all, pinned, reminders, Kali's) sit on top; each card has its kind as an icon, the pin when it
 * is pinned, the text or the list, the reminder time in the accent, and who wrote it. "+" in the
 * header adds a note here. The content is `{ notes: [{ title, text?, kind?, items?, when?, pinned?,
 * author?, source? }] }` with kind one of note, reminder, list, link, voice.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, Clock, Link2, Mic, Pin, Plus, Search, StickyNote, type LucideIcon } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample } from "../../stage/v2/shell";

export type NoteKind = "note" | "reminder" | "list" | "link" | "voice";
export interface Note {
  title: string; text?: string; kind: NoteKind; items?: string[]; when?: string;
  pinned?: boolean; author: "you" | "kali"; source?: string;
}

const KIND_ICON: Record<NoteKind, LucideIcon> = { note: StickyNote, reminder: Bell, list: Check, link: Link2, voice: Mic };
type Filter = "all" | "pinned" | "reminder" | "kali";

const SAMPLE: Note[] = [
  { title: "Ideas para la vitrina", text: "Poner el reloj en reparación con su caja abierta. Una tarjeta explica cada pieza.", kind: "note", pinned: true, author: "you", source: "ayer" },
  { title: "Llamar al proveedor", text: "Preguntar por el plazo de los cristales y el costo del envío.", kind: "reminder", when: "Hoy 17:00", author: "you" },
  { title: "Compras del taller", kind: "list", items: ["Aceite para relojería", "Paños sin pelusa", "Pinzas de punta fina"], author: "you" },
  { title: "Nota de voz", text: "«Recordar probar la corona antes de cerrar la caja».", kind: "voice", author: "you", source: "hoy 10:20" },
  { title: "Guía de lubricación", text: "Resumen del manual, página 2: una gota por rubí.", kind: "link", pinned: true, author: "kali", source: "manual-de-servicio.pdf" },
  { title: "Pendiente de decidir", text: "Si cobrar por separado el cambio de cristal o incluirlo en la revisión.", kind: "note", author: "you", source: "lunes" },
];

export function readNotes(data: unknown): Note[] | null {
  const d = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.notes)) return null;
  return (d.notes as Record<string, unknown>[])
    .filter((x) => x && typeof x.title === "string")
    .map((x) => ({
      title: x.title as string,
      text: typeof x.text === "string" ? x.text : undefined,
      kind: (Object.keys(KIND_ICON).includes(x.kind as string) ? x.kind : Array.isArray(x.items) ? "list" : "note") as NoteKind,
      items: Array.isArray(x.items) ? (x.items as unknown[]).map(String) : undefined,
      when: typeof x.when === "string" ? x.when : undefined,
      pinned: x.pinned === true,
      author: x.author === "kali" ? "kali" : "you",
      source: typeof x.source === "string" ? x.source : undefined,
    }));
}

export function matchesNote(n: Note, q: string): boolean {
  if (!q) return true;
  const hay = [n.title, n.text, n.source, ...(n.items ?? [])].filter(Boolean).join(" ").toLocaleLowerCase();
  return q.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function NotesWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const real = useMemo(() => (isReal ? readNotes(data) : null), [data, isReal]);
  const initial = real ?? SAMPLE;
  const [notes, setNotes] = useState<Note[]>(initial);
  useEffect(() => setNotes(initial), [initial]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", text: "" });

  const shown = notes.filter((n) => matchesNote(n, q) && (
    filter === "all" || (filter === "pinned" && n.pinned) || (filter === "reminder" && n.kind === "reminder") || (filter === "kali" && n.author === "kali")
  ));
  const pinned = notes.filter((n) => n.pinned).length;
  const reminders = notes.filter((n) => n.kind === "reminder").length;

  useShellSample(!real);

  const add = () => {
    if (!draft.title.trim() && !draft.text.trim()) return;
    setNotes((prev) => [{ title: draft.title.trim() || draft.text.trim().slice(0, 40), text: draft.text.trim() || undefined, kind: "note", author: "you", source: t("v2.notes.now") as string }, ...prev]);
    setDraft({ title: "", text: "" });
    setAdding(false);
  };

  return (
    <BaseWidget>
      {!compact && (
        <WidgetToolbar>
          <button type="button" className="v2-icon-btn" aria-label={t("v2.notes.new") as string} title={t("v2.notes.new") as string} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </WidgetToolbar>
      )}
      <div className="kw-notes">
        {!compact && (
          <div className="kw-notes-bar">
            <label className="kw-notes-search">
              <Search size={14} aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v2.notes.search") as string} aria-label={t("v2.notes.search") as string} />
            </label>
            <div className="kw-chips" role="group" aria-label={t("v2.notes.filter") as string}>
              {(["all", "pinned", "reminder", "kali"] as Filter[]).map((f) => (
                <button key={f} type="button" className="kw-chip is-button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`v2.notes.filter_${f}`)}</button>
              ))}
            </div>
          </div>
        )}
        <div className="kw-notes-grid scrollbar-thin">
          {adding && (
            <form className="kw-note is-draft" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input autoFocus className="kw-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("v2.notes.title_placeholder") as string} aria-label={t("v2.notes.title_placeholder") as string} />
              <textarea className="kw-input" rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder={t("v2.notes.text_placeholder") as string} aria-label={t("v2.notes.text_placeholder") as string}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }} />
              <div className="flex gap-2 justify-end">
                <button type="button" className="v2-btn is-quiet" onClick={() => setAdding(false)}>{t("v2.notes.cancel")}</button>
                <button type="submit" className="v2-btn is-primary">{t("v2.notes.save")}</button>
              </div>
            </form>
          )}
          {shown.map((n, i) => {
            const Icon = KIND_ICON[n.kind];
            const author = t(n.author === "kali" ? "v2.notes.by_kali" : "v2.notes.by_you");
            return (
              <article key={i} className={`kw-note ${n.pinned ? "is-pinned" : ""}`}>
                <header>
                  <Icon size={15} aria-hidden="true" />
                  <h3>{n.title}</h3>
                  {n.pinned && <Pin size={13} className="kw-note-pin" aria-label={t("v2.notes.pinned") as string} />}
                </header>
                {n.text && <p>{n.text}</p>}
                {n.items && <ul>{n.items.map((it, k) => <li key={k}>{it}</li>)}</ul>}
                {n.kind === "reminder" && n.when && <div className="kw-note-when"><Clock size={12} aria-hidden="true" />{n.when}</div>}
                <footer>{[author, n.kind === "reminder" ? t("v2.notes.reminder") : n.source].filter(Boolean).join(" · ")}</footer>
              </article>
            );
          })}
          {!shown.length && !adding && <div className="kw-empty">{t("v2.notes.none")}</div>}
        </div>
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.notes.count", { count: notes.length })}</span>
        {pinned > 0 && <span className="v2-foot-item">{t("v2.notes.pinned_count", { count: pinned })}</span>}
        {reminders > 0 && <span className="v2-foot-item">{t("v2.notes.reminders", { count: reminders })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
