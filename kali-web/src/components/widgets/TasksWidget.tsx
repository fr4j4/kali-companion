/**
 * TasksWidget — a board of three columns (to do, doing, done) with who owns each task, when it is
 * due and how far along it is. Filters show all, yours or Kali's; a card can be dragged to another
 * column, and "Nueva tarea" adds one to the first column. Kali's open tasks are outlined in the
 * accent so the user sees at a glance what she is on. The content is
 * `{ tasks: [{ title, status: "todo"|"doing"|"done", owner: "you"|"kali", due?, progress? }] }`.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";

export type TaskStatus = "todo" | "doing" | "done";
export interface Task { title: string; status: TaskStatus; owner: "you" | "kali"; due?: string; progress?: number }

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
type Filter = "all" | "you" | "kali";

const SAMPLE: Task[] = [
  { title: "Escribir el aviso de costos para clientes", status: "todo", owner: "you", due: "Vence mañana" },
  { title: "Pedir repuestos de corona", status: "todo", owner: "you", due: "Esta semana" },
  { title: "Revisar el contraste de las tarjetas", status: "todo", owner: "kali", due: "Hoy" },
  { title: "Armar la portada del sitio", status: "doing", owner: "kali", due: "Hoy", progress: 0.7 },
  { title: "Cotizar cristales con el proveedor", status: "doing", owner: "you", due: "Jueves", progress: 0.4 },
  { title: "Elegir tipografías del sitio", status: "done", owner: "kali", due: "Ayer" },
  { title: "Ordenar fotos del taller", status: "done", owner: "you", due: "Lunes" },
];

/** Tasks from the content, with unknown statuses and owners read as "todo" and "you". */
export function readTasks(data: unknown): Task[] | null {
  const d = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.tasks)) return null;
  return (d.tasks as Record<string, unknown>[])
    .filter((x) => x && typeof x.title === "string")
    .map((x) => {
      const status = (["todo", "doing", "done"].includes(x.status as string) ? x.status : x.status === "in_progress" ? "doing" : "todo") as TaskStatus;
      const progress = typeof x.progress === "number" ? Math.max(0, Math.min(1, x.progress > 1 ? x.progress / 100 : x.progress)) : undefined;
      return { title: x.title as string, status, owner: x.owner === "kali" ? "kali" : "you", due: typeof x.due === "string" ? x.due : undefined, progress };
    });
}

export function TasksWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const real = useMemo(() => (isReal ? readTasks(data) : null), [data, isReal]);
  const initial = real ?? SAMPLE;
  const [tasks, setTasks] = useState<Task[]>(initial);
  useEffect(() => setTasks(initial), [initial]);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  useShellSubtitle(t("v2.tasks.subtitle", { count: tasks.filter((x) => x.status !== "done").length }));
  useShellSample(!real);

  const shown = tasks.map((task, idx) => ({ task, idx })).filter(({ task }) => filter === "all" || task.owner === filter);
  const kaliCount = tasks.filter((x) => x.owner === "kali").length;
  const doing = tasks.filter((x) => x.status === "doing").length;

  const move = (idx: number, status: TaskStatus) =>
    setTasks((prev) => prev.map((x, i) => (i === idx ? { ...x, status, progress: status === "done" ? undefined : x.progress } : x)));
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setTasks((prev) => [{ title, status: "todo", owner: "you" }, ...prev]);
    setDraft("");
    setAdding(false);
  };

  return (
    <BaseWidget>
      <div className="kw-tasks">
        {!compact && (
          <div className="kw-tasks-bar">
            <div className="kw-chips" role="group" aria-label={t("v2.tasks.filter") as string}>
              {(["all", "you", "kali"] as Filter[]).map((f) => (
                <button key={f} type="button" className="kw-chip is-button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`v2.tasks.filter_${f}`)}</button>
              ))}
            </div>
            <button type="button" className="v2-btn is-primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}><Plus size={14} aria-hidden="true" />{t("v2.tasks.new")}</button>
          </div>
        )}
        <div className={`kw-tasks-board ${compact ? "is-compact" : ""}`}>
          {COLUMNS.map((col) => {
            const items = shown.filter(({ task }) => task.status === col);
            return (
              <section
                key={col}
                className="kw-tasks-col"
                data-over={over === col || undefined}
                aria-label={t(`v2.tasks.col_${col}`) as string}
                onDragOver={(e) => { if (dragging != null) { e.preventDefault(); setOver(col); } }}
                onDragLeave={() => setOver((o) => (o === col ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragging != null) move(dragging, col); setDragging(null); setOver(null); }}
              >
                <header><h3>{t(`v2.tasks.col_${col}`)}</h3><span className="kw-mono">{items.length}</span></header>
                <ul className="scrollbar-thin">
                  {col === "todo" && adding && (
                    <li>
                      <form className="kw-task is-draft" onSubmit={(e) => { e.preventDefault(); add(); }}>
                        <input
                          autoFocus
                          className="kw-input"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }}
                          placeholder={t("v2.tasks.new_placeholder") as string}
                          aria-label={t("v2.tasks.new") as string}
                        />
                      </form>
                    </li>
                  )}
                  {items.map(({ task, idx }) => (
                    <li key={idx}>
                      <div
                        className={`kw-task ${task.owner === "kali" && task.status !== "done" ? "is-kali" : ""}`}
                        draggable={!compact}
                        data-dragging={dragging === idx || undefined}
                        onDragStart={(e) => { setDragging(idx); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.title); }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                      >
                        <strong>{task.title}</strong>
                        <div className="kw-task-meta">
                          <span className="kw-task-owner">{t(task.owner === "kali" ? "v2.tasks.owner_kali" : "v2.tasks.owner_you")}</span>
                          {task.due && <span>{task.due}</span>}
                        </div>
                        {task.status === "doing" && task.progress != null && (
                          <div className="kw-break-track is-thin" role="progressbar" aria-valuenow={Math.round(task.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={task.title}>
                            <div style={{ width: `${task.progress * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.tasks.count", { count: tasks.length })}</span>
        <span className="v2-foot-item">{t("v2.tasks.of_kali", { count: kaliCount })}</span>
        {doing > 0 && <span className="v2-foot-item">{t("v2.tasks.doing", { count: doing })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
