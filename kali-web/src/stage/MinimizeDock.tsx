import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import type { WindowData } from "../workspace/types";

interface Props {
  windows: WindowData[];
  onRestore: (id: number) => void;
}

export function MinimizeDock({ windows, onRestore }: Props) {
  const { t } = useTranslation();
  const minimized = windows.filter((w) => w.minimized && !w.closed);

  return (
    <div id="minimize-dock">
      <AnimatePresence>
        {minimized.map((w) => (
          <motion.div
            key={w.id}
            className="min-bar"
            onClick={() => onRestore(w.id)}
            role="button"
            tabIndex={0}
            aria-label={t("dock.minimize.restore", { title: w.title }) as string}
            onKeyDown={(e) => { if (e.key === "Enter") onRestore(w.id); }}
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>{w.icon}</span>
            <span className="truncate">{w.title}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
