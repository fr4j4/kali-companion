// SessionDrawer — slide-in panel listing past sessions.
//
// Replaces the always-visible Sidebar. Opens from the bottom-left HUD
// button. New chat + session list with relative dates.

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import type { SessionListItem } from "../hooks/useChat";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onNewSession: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

export function SessionDrawer({ open, onClose, sessions, activeSessionId, onNewSession }: Props) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.aside
            className="absolute left-0 top-0 h-full w-[300px] max-w-[85vw] bg-elevated border-r border-border flex flex-col"
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-border flex items-center gap-2">
              <span className="text-xs text-muted flex-1">{t("sidebar.sessions")}</span>
              <button
                className="dock-btn w-8 h-8"
                onClick={onNewSession}
                aria-label={t("sidebar.new_chat")}
              >
                <Plus size={15} />
              </button>
              <button
                className="dock-btn w-8 h-8"
                onClick={onClose}
                aria-label={t("common.aria_close")}
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto stage-scroll p-2">
              {sessions.length === 0 && (
                <p className="text-muted text-sm text-center py-6">{t("sidebar.sessions")}</p>
              )}
              {sessions.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/session/${s.id}`}
                  onClick={onClose}
                  className={`sidebar-item ${s.id === activeSessionId ? "active" : ""}`}
                >
                  <span className="sidebar-item-title">{s.title}</span>
                  <span className="sidebar-item-date">{formatDate(s.updated)}</span>
                </NavLink>
              ))}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}