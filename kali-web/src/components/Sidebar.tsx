import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import type { SessionListItem } from "../hooks/useChat";

interface Props {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onNewSession: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function Sidebar({
  sessions,
  activeSessionId,
  onNewSession,
  collapsed,
  onToggle,
}: Props) {
  const { t } = useTranslation();

  return (
    <aside
      className={`shrink-0 border-r border-border bg-elevated flex flex-col overflow-hidden relative ${collapsed ? "w-0 min-w-0 border-r-0 overflow-hidden" : "w-[260px]"}`}
    >
      <div className="p-3 border-b border-border flex items-center gap-2">
        <span className="text-xs text-muted flex-1">{t("sidebar.sessions")}</span>
        <button className="bg-transparent border border-border text-foreground rounded-md px-2 py-1 text-xs cursor-pointer whitespace-nowrap hover:bg-surface" onClick={onNewSession}>{t("sidebar.new_chat")}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {sessions.map((s) => (
          <NavLink
            key={s.id}
            to={`/session/${s.id}`}
            className={`sidebar-item ${s.id === activeSessionId ? "active" : ""}`}
          >
            <span className="sidebar-item-title">{s.title}</span>
            <span className="sidebar-item-date">{formatDate(s.updated)}</span>
          </NavLink>
        ))}
      </div>
      <button className="sidebar-toggle absolute right-2 top-2" onClick={onToggle} aria-label="Toggle sidebar">
        ◀
      </button>
    </aside>
  );
}
