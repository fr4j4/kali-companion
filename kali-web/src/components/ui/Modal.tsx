import { type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  size?: "md" | "xl";
  bare?: boolean;
}

export function Modal({ open, onClose, children, title, size = "md", bare = false }: Props) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const trapRef = useFocusTrap(open && !isMobile);

  useBodyScrollLock(open);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  if (isMobile) {
    return (
      <Sheet side="bottom" open={open} onClose={onClose} title={title}>
        {children}
      </Sheet>
    );
  }

  const sizeClass = size === "xl" ? "max-w-2xl" : "max-w-md";
  const closeLabel = t("common.aria_close") as string;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className={`bg-elevated border border-border rounded-xl shadow-lg w-full ${sizeClass} max-h-[85vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground m-0">{title}</h2>
            <button
              className="bg-transparent border-none text-muted text-base cursor-pointer hover:text-foreground transition-colors"
              onClick={onClose}
              aria-label={closeLabel}
            >
              ✕
            </button>
          </div>
        )}
        <div className={bare ? "flex-1 overflow-hidden" : "p-5 flex flex-col gap-4 overflow-y-auto"}>
          {children}
        </div>
      </div>
    </div>
  );
}