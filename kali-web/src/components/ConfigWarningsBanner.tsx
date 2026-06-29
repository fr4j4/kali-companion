import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  warnings: string[];
  onOpenSettings?: () => void;
}

export function ConfigWarningsBanner({ warnings, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (warnings.length === 0 || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed top-16 left-1/2 -translate-x-1/2 z-40 max-w-[min(560px,92vw)]"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 shadow-lg backdrop-blur-md">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-200">
              {t("config_warnings.title")}
            </p>
            <ul className="mt-1 space-y-0.5">
              {warnings.slice(0, 5).map((w, i) => (
                <li key={i} className="text-xs leading-relaxed text-amber-200/80">
                  {w}
                </li>
              ))}
              {warnings.length > 5 && (
                <li className="text-xs text-amber-200/60">
                  +{warnings.length - 5} {t("config_warnings.more")}
                </li>
              )}
            </ul>
            {onOpenSettings && (
              <button
                onClick={() => {
                  onOpenSettings();
                  setDismissed(true);
                }}
                className="mt-1.5 text-xs font-medium text-amber-300 underline-offset-2 hover:underline"
              >
                {t("config_warnings.open_settings")}
              </button>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-0.5 text-amber-200/60 transition-colors hover:text-amber-200"
            aria-label={t("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}