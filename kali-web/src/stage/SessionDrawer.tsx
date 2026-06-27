import { useState, useCallback, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, Trash2 } from "lucide-react";
import type { SessionListItem } from "../hooks/useChat";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onClearAllSessions: () => void;
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

export function SessionDrawer({ open, onClose, sessions, activeSessionId, onNewSession, onDeleteSession, onClearAllSessions }: Props) {
  const { t } = useTranslation();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  const handleDeleteClick = useCallback((sid: string) => {
    setConfirmingId(sid);
  }, []);

  const handleConfirmDelete = useCallback((sid: string) => {
    setConfirmingId(null);
    onDeleteSession(sid);
  }, [onDeleteSession]);

  const handleCancelDelete = useCallback(() => {
    setConfirmingId(null);
  }, []);

  const handleDeleteAllClick = useCallback(() => {
    setShowDeleteAllModal(true);
  }, []);

  const handleConfirmDeleteAll = useCallback(() => {
    setShowDeleteAllModal(false);
    onClearAllSessions();
  }, [onClearAllSessions]);

  const handleCancelDeleteAll = useCallback(() => {
    setShowDeleteAllModal(false);
  }, []);

  useEffect(() => {
    if (!confirmingId) return;
    const handler = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setConfirmingId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [confirmingId]);

  return (
    <>
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
                {sessions.length > 1 && (
                  <button
                    className="dock-btn w-8 h-8 text-muted hover:text-red-300 hover:bg-red-500/15 transition"
                    onClick={handleDeleteAllClick}
                    aria-label={t("sidebar.delete_all")}
                    title={t("sidebar.delete_all")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
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
                  <p className="text-muted text-sm text-center py-6">{t("sidebar.no_sessions")}</p>
                )}
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`sidebar-item ${s.id === activeSessionId ? "active" : ""}`}
                  >
                    {confirmingId === s.id ? (
                      <div ref={confirmRef} className="flex items-center gap-2 px-3 py-2">
                        <span className="text-xs text-muted flex-1">{t("sidebar.delete_session_confirm")}</span>
                        <button
                          className="text-[11px] font-medium text-muted hover:text-fg transition px-2 py-1 rounded hover:bg-white/10"
                          onClick={handleCancelDelete}
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          className="text-[11px] font-medium text-red-300 hover:text-red-200 transition px-2 py-1 rounded hover:bg-red-500/15"
                          onClick={() => handleConfirmDelete(s.id)}
                        >
                          {t("sidebar.delete_session")}
                        </button>
                      </div>
                    ) : (
                      <NavLink
                        to={`/session/${s.id}`}
                        onClick={onClose}
                        className="sidebar-item-link flex items-center gap-2"
                      >
                        <span className="sidebar-item-title flex-1 truncate">{s.title}</span>
                        <span className="sidebar-item-date shrink-0">{formatDate(s.updated)}</span>
                        <button
                          className="shrink-0 w-6 h-6 flex items-center justify-center text-muted/30 hover:text-red-300 transition-colors"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteClick(s.id);
                          }}
                          aria-label={t("sidebar.delete_session")}
                          title={t("sidebar.delete_session")}
                        >
                          <Trash2 size={12} />
                        </button>
                      </NavLink>
                    )}
                  </div>
                ))}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteAllModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancelDeleteAll}
          >
            <motion.div
              className="bg-elevated border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-fg mb-2">{t("sidebar.delete_all_confirm_title")}</h3>
              <p className="text-xs text-muted leading-relaxed mb-5">{t("sidebar.delete_all_confirm_body")}</p>
              <div className="flex items-center justify-end gap-2">
                <button
                  className="px-3 py-1.5 text-xs font-medium text-muted hover:text-fg transition rounded-lg hover:bg-white/10"
                  onClick={handleCancelDeleteAll}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="px-3 py-1.5 text-xs font-medium text-red-300 hover:text-red-200 transition rounded-lg hover:bg-red-500/15"
                  onClick={handleConfirmDeleteAll}
                >
                  {t("sidebar.delete_all")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
