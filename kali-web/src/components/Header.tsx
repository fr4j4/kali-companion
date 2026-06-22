import { useTranslation } from "react-i18next";
import type { ConnStatus } from "../hooks/useChat";
import type { StatusEvent } from "../lib/protocol";

interface Props {
  status: ConnStatus;
  systemStatus: StatusEvent | null;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onLanguageChange: (lang: string) => void;
  currentLanguage: string;
  wakeWordActive?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  canvasCollapsed?: boolean;
  onToggleCanvas?: () => void;
  onOpenJobs?: () => void;
  jobsActive?: number;
}

export function Header({
  status,
  systemStatus,
  onNewSession,
  onOpenSettings,
  onLanguageChange,
  currentLanguage,
  wakeWordActive,
  sidebarCollapsed,
  onToggleSidebar,
  canvasCollapsed,
  onToggleCanvas,
  onOpenJobs,
  jobsActive,
}: Props) {
  const { t } = useTranslation();
  const statusKey = `status.${status}`;

  return (
    <header className="flex items-center justify-between px-3 md:px-5 py-2.5 border-b border-border bg-elevated gap-2">
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <button
          className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center hover:bg-surface transition-colors"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? "☰" : "◀"}
        </button>
        <span className="font-semibold text-sm">
          🐾<span className="max-xs:hidden"> Kali</span>
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-3">
        <span className={`text-xs px-2.5 py-1 rounded-full border border-border status-${status}`}>
          {t(statusKey)}
        </span>
        {wakeWordActive && (
          <span className="wake-word-badge" title={t("wake_word.listening")}>
            🎙️ {t("wake_word.listening")}
          </span>
        )}
        {systemStatus && (
          <span className="model-badge">{systemStatus.llm_model}</span>
        )}
      </div>
      <div className="flex items-center gap-1 md:gap-3 shrink-0">
        <button
          className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center hover:bg-surface transition-colors"
          onClick={onToggleCanvas}
          aria-label="Toggle canvas"
        >
          {canvasCollapsed ? "🎨" : "▶"}
        </button>
        <select
          className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-h-[44px]"
          value={currentLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          aria-label={t("settings.language")}
        >
          <option value="en">{t("language.en")}</option>
          <option value="es">{t("language.es")}</option>
        </select>
        <button
          className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center hover:bg-surface transition-colors relative"
          onClick={onNewSession}
          aria-label="New chat"
        >
          ➕
        </button>
        {onOpenJobs && (
          <button
            className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center hover:bg-surface transition-colors relative"
            onClick={onOpenJobs}
            aria-label="Jobs"
          >
            ⚡
            {jobsActive != null && jobsActive > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {jobsActive}
              </span>
            )}
          </button>
        )}
        <button
          className="bg-transparent border border-border text-foreground rounded-md px-2 py-1.5 text-sm cursor-pointer max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center hover:bg-surface transition-colors"
          onClick={onOpenSettings}
          aria-label={t("settings.title")}
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}