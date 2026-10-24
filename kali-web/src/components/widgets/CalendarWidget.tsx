/**
 * CalendarWidget — a week the user can look at, not a calendar Kali books on her own.
 *
 * A grid of hours by weekday with today in the accent; events Kali proposes are dashed and say so.
 * The side panel shows the chosen day (today when it is in the week) and Kali's note with
 * "Reservar" / "Ahora no", which answer her in the conversation: booking goes through her tools,
 * with the user's permission. A list view reads the same week as an agenda. The content is
 * `{ week_of: "YYYY-MM-DD", events: [{ title, day, start: "HH:MM", end, proposed? }], note?, timezone? }`.
 */

import { useMemo, useState } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, List, MessageSquare } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useStage } from "../../stage/StageProvider";

export interface CalEvent { title: string; day: string; start: string; end: string; proposed?: boolean }
export interface CalData { week_of: string; events: CalEvent[]; note?: string; timezone?: string }

const SAMPLE: CalData = {
  week_of: "2026-10-19",
  timezone: "Santiago",
  note: "Dejé dos horas libres por la tarde para la portada del sitio. ¿Las reservo?",
  events: [
    { title: "Revisión de relojes", day: "2026-10-19", start: "10:00", end: "11:00" },
    { title: "Llamada con proveedor", day: "2026-10-20", start: "09:30", end: "10:30" },
    { title: "Entrega de pedidos", day: "2026-10-21", start: "11:00", end: "12:30" },
    { title: "Capacitación", day: "2026-10-22", start: "10:00", end: "11:00" },
    { title: "Reunión de planificación", day: "2026-10-23", start: "11:00", end: "12:00" },
    { title: "Trabajo concentrado", day: "2026-10-23", start: "15:00", end: "17:00", proposed: true },
  ],
};

const HOUR_PX = 44;

/** "YYYY-MM-DD" as a local date (no time zone shift). */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Minutes since midnight of "HH:MM". */
export function minutesOf(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Monday of the week that holds `d`. */
export function mondayOf(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function readCal(data: unknown): CalData | null {
  const d = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.events)) return null;
  const events = (d.events as Record<string, unknown>[])
    .filter((e) => e && typeof e.title === "string" && typeof e.day === "string" && parseDay(e.day as string) && minutesOf(String(e.start ?? "")) != null)
    .map((e) => ({ title: e.title as string, day: e.day as string, start: String(e.start), end: typeof e.end === "string" && minutesOf(e.end) != null ? e.end : String(e.start), proposed: e.proposed === true }));
  const first = events.map((e) => e.day).sort()[0];
  return {
    week_of: typeof d.week_of === "string" && parseDay(d.week_of) ? d.week_of : first ?? dayKey(new Date()),
    events,
    note: typeof d.note === "string" ? d.note : undefined,
    timezone: typeof d.timezone === "string" ? d.timezone : undefined,
  };
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

export function CalendarWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const real = useMemo(() => (isReal ? readCal(data) : null), [data, isReal]);
  const cal = real ?? SAMPLE;
  const lang = i18n.language || undefined;
  const [weekShift, setWeekShift] = useState(0);
  const [view, setView] = useState<"week" | "list">("week");
  const [answered, setAnswered] = useState<"book" | "decline" | null>(null);

  const monday = useMemo(() => {
    const m = mondayOf(parseDay(cal.week_of) ?? new Date());
    m.setDate(m.getDate() + weekShift * 7);
    return m;
  }, [cal.week_of, weekShift]);
  const todayKey = dayKey(new Date());
  const weekEvents = useMemo(() => {
    const keys = new Set(Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return dayKey(d); }));
    return cal.events.filter((e) => keys.has(dayKey(parseDay(e.day)!)));
  }, [cal.events, monday]);
  const weekend = weekEvents.some((e) => { const g = parseDay(e.day)!.getDay(); return g === 0 || g === 6; });
  const days = Array.from({ length: weekend ? 7 : 5 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const dayKeys = days.map(dayKey);
  const [picked, setPicked] = useState<string | null>(null);
  const focusDay = picked && dayKeys.includes(picked) ? picked : dayKeys.includes(todayKey) ? todayKey
    : dayKeys.find((k) => weekEvents.some((e) => e.day.startsWith(k))) ?? dayKeys[0];

  const startH = Math.min(9, ...weekEvents.map((e) => Math.floor(minutesOf(e.start)! / 60)));
  const endH = Math.max(17, ...weekEvents.map((e) => Math.ceil(minutesOf(e.end)! / 60)));
  const hours = Array.from({ length: Math.max(1, endH - startH) }, (_, i) => startH + i);
  const proposed = weekEvents.filter((e) => e.proposed);

  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(lang, o);
  const last = days[days.length - 1];
  const range = days[0].getMonth() === last.getMonth()
    ? t("v2.calendar.range", { from: days[0].getDate(), to: fmt(last, { day: "numeric", month: "long" }) })
    : t("v2.calendar.range", { from: fmt(days[0], { day: "numeric", month: "short" }), to: fmt(last, { day: "numeric", month: "short" }) });

  useShellSubtitle(t("v2.calendar.week_of", { date: fmt(days[0], { day: "numeric", month: "long" }) }));
  useShellSample(!real);

  const book = () => { chat.send(t("v2.calendar.book_msg", { titles: proposed.map((e) => `${e.title} (${fmt(parseDay(e.day)!, { weekday: "long", day: "numeric" })}, ${e.start}–${e.end})`).join("; ") })); setAnswered("book"); };
  const decline = () => { chat.send(t("v2.calendar.decline_msg")); setAnswered("decline"); };

  const focusDate = parseDay(focusDay)!;
  const dayEvents = weekEvents.filter((e) => e.day.startsWith(focusDay)).sort((a, b) => minutesOf(a.start)! - minutesOf(b.start)!);
  const label = (e: CalEvent) => `${e.title}, ${e.start}–${e.end}${e.proposed ? `, ${t("v2.calendar.proposed")}` : ""}`;

  const side = (
    <aside className="kw-cal-side scrollbar-thin">
      <h3 className="kw-side-title is-inline">
        {focusDay === todayKey ? t("v2.calendar.today", { day: fmt(focusDate, { weekday: "long", day: "numeric" }) }) : cap(fmt(focusDate, { weekday: "long", day: "numeric" }))}
      </h3>
      {dayEvents.length ? dayEvents.map((e, i) => (
        <div key={i} className={`kw-cal-agenda ${e.proposed ? "is-proposed" : ""}`}>
          <span className="kw-mono">{t("v2.calendar.from_to", { from: e.start, to: e.end })}</span>
          <strong>{e.title}</strong>
        </div>
      )) : <p className="kw-dim text-[13px]">{t("v2.calendar.free")}</p>}
      {cal.note && !answered && (
        <div className="kw-cal-note">
          <div className="kw-cal-note-head"><MessageSquare size={13} aria-hidden="true" />Kali</div>
          <p>{cal.note}</p>
        </div>
      )}
      {cal.note && isReal && proposed.length > 0 && (
        answered ? <span className="kw-review-done is-ok">{t(answered === "book" ? "v2.calendar.book_sent" : "v2.calendar.decline_sent")}</span> : (
          <div className="flex gap-2">
            <button type="button" className="v2-btn is-primary" onClick={book}>{t("v2.calendar.book")}</button>
            <button type="button" className="v2-btn" onClick={decline}>{t("v2.calendar.decline")}</button>
          </div>
        )
      )}
    </aside>
  );

  return (
    <BaseWidget>
      <div className="kw-cal">
        {!compact && (
          <div className="kw-cal-bar">
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.calendar.prev") as string} onClick={() => setWeekShift((w) => w - 1)}><ChevronLeft size={15} aria-hidden="true" /></button>
            <strong>{range}</strong>
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.calendar.next") as string} onClick={() => setWeekShift((w) => w + 1)}><ChevronRight size={15} aria-hidden="true" /></button>
            {weekShift !== 0 && <button type="button" className="v2-btn is-quiet" onClick={() => setWeekShift(0)}>{t("v2.calendar.back")}</button>}
            <div className="kw-seg ml-auto" role="group" aria-label={t("v2.calendar.view") as string}>
              <button type="button" aria-pressed={view === "week"} aria-label={t("v2.calendar.view_week") as string} title={t("v2.calendar.view_week") as string} onClick={() => setView("week")}><CalendarDays size={14} aria-hidden="true" /></button>
              <button type="button" aria-pressed={view === "list"} aria-label={t("v2.calendar.view_list") as string} title={t("v2.calendar.view_list") as string} onClick={() => setView("list")}><List size={14} aria-hidden="true" /></button>
            </div>
          </div>
        )}
        <div className="kw-cal-body">
          {compact || view === "list" ? (
            <div className="kw-cal-list scrollbar-thin">
              {days.map((d, i) => {
                const evs = weekEvents.filter((e) => e.day.startsWith(dayKeys[i])).sort((a, b) => minutesOf(a.start)! - minutesOf(b.start)!);
                if (!evs.length) return null;
                return (
                  <section key={i}>
                    <h3 className={dayKeys[i] === todayKey ? "is-today" : ""}>{cap(fmt(d, { weekday: "long", day: "numeric", month: "long" }))}</h3>
                    {evs.map((e, k) => (
                      <div key={k} className={`kw-cal-agenda ${e.proposed ? "is-proposed" : ""}`}>
                        <span className="kw-mono">{t("v2.calendar.from_to", { from: e.start, to: e.end })}</span>
                        <strong>{e.title}</strong>
                        {e.proposed && <span className="kw-dim">{t("v2.calendar.proposed")}</span>}
                      </div>
                    ))}
                  </section>
                );
              })}
              {!weekEvents.length && <div className="kw-empty">{t("v2.calendar.empty")}</div>}
            </div>
          ) : (
            <div className="kw-cal-grid scrollbar-thin" style={{ ["--cal-cols" as string]: days.length, ["--cal-hour" as string]: `calc(${HOUR_PX}px * var(--k, 1))` }}>
              <div className="kw-cal-head" aria-hidden="true">
                <span />
                {days.map((d, i) => (
                  <button key={i} type="button" className={dayKeys[i] === todayKey ? "is-today" : ""} aria-pressed={focusDay === dayKeys[i]} onClick={() => setPicked(dayKeys[i])} tabIndex={-1}>
                    {cap(fmt(d, { weekday: "short" }).replace(".", ""))} {d.getDate()}
                  </button>
                ))}
              </div>
              <div className="kw-cal-hours" role="grid" aria-label={range}>
                <div className="kw-cal-times" aria-hidden="true">
                  {hours.map((h) => <span key={h} className="kw-mono">{h}:00</span>)}
                </div>
                {days.map((_, i) => (
                  <div key={i} className={`kw-cal-day ${dayKeys[i] === todayKey ? "is-today" : ""}`} role="gridcell" aria-label={cap(fmt(days[i], { weekday: "long", day: "numeric" }))}>
                    {hours.map((h) => <i key={h} />)}
                    {weekEvents.filter((e) => e.day.startsWith(dayKeys[i])).map((e, k) => {
                      const top = (minutesOf(e.start)! - startH * 60) / 60;
                      const len = Math.max(0.5, (minutesOf(e.end)! - minutesOf(e.start)!) / 60);
                      return (
                        <button
                          key={k}
                          type="button"
                          className={`kw-cal-event ${e.proposed ? "is-proposed" : ""}`}
                          style={{ top: `calc(var(--cal-hour) * ${top})`, height: `calc(var(--cal-hour) * ${len} - 4px)` }}
                          aria-label={label(e)}
                          title={label(e)}
                          onClick={() => setPicked(dayKeys[i])}
                        >
                          <strong>{e.title}</strong>
                          {e.proposed && <span>{t("v2.calendar.proposed")}</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!compact && side}
        </div>
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.calendar.events", { count: weekEvents.length })}</span>
        {proposed.length > 0 && <span className="v2-foot-item">{t("v2.calendar.proposals", { count: proposed.length })}</span>}
        {cal.timezone && <span className="v2-foot-item">{t("v2.calendar.timezone", { tz: cal.timezone })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
