import { type ReactNode, useCallback } from "react";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export function Modal({ open, onClose, children, title }: Props) {
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

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className="bg-elevated border border-border rounded-xl shadow-lg w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground m-0">{title}</h2>
            <button
              className="bg-transparent border-none text-muted text-base cursor-pointer"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        <div className="p-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
