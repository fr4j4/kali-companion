import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useFocusTrap } from "../../hooks/useFocusTrap";

type Side = "left" | "right" | "bottom";

interface Props {
  side: Side;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

function sideClasses(side: Side, open: boolean): string {
  const base = "fixed bg-elevated border-border z-50 transition-transform duration-300 ease-in-out";
  if (side === "bottom") {
    return `${base} inset-x-0 bottom-0 rounded-t-sheet max-h-[85vh] overflow-auto border-t ${
      open ? "translate-y-0" : "translate-y-full"
    }`;
  }
  if (side === "left") {
    return `${base} inset-y-0 left-0 w-[80vw] max-w-sidebar border-r ${
      open ? "translate-x-0" : "-translate-x-full"
    }`;
  }
  return `${base} inset-y-0 right-0 w-[80vw] max-w-sidebar border-l ${
    open ? "translate-x-0" : "translate-x-full"
  }`;
}

export function Sheet({ side, open, onClose, children, title }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(open);
  const trapRef = useFocusTrap(open);
  const startY = useRef(0);
  const dragging = useRef(false);

  useBodyScrollLock(open && side === "bottom");

  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);

  function onTransitionEnd() {
    if (!open) setVisible(false);
  }

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (side === "bottom") {
      startY.current = e.clientY;
      dragging.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || side !== "bottom") return;
    const diff = e.clientY - startY.current;
    if (diff > 80) {
      dragging.current = false;
      onClose();
    }
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  if (!visible && !open) return null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={(el) => {
          (trapRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        className={sideClasses(side, open)}
        onTransitionEnd={onTransitionEnd}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {side === "bottom" && (
          <div className="flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 rounded-full bg-muted/40" />
          </div>
        )}
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground m-0">{title}</h2>
            <button
              className="bg-transparent border-none text-muted text-base cursor-pointer p-1"
              onClick={onClose}
              aria-label={t("common.aria_close") as string}
            >
              ✕
            </button>
          </div>
        )}
        <div className="overflow-auto h-full">{children}</div>
      </div>
    </>
  );
}
