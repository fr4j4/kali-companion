import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useBreakpoint } from "../../hooks/useBreakpoint";

type OverlayVariant = "modal" | "sheet-bottom" | "sheet-left" | "sheet-right" | "drawer";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  variant?: OverlayVariant;
  size?: "sm" | "md" | "lg" | "xl";
  bare?: boolean;
  showHandle?: boolean;
  panelClassName?: string;
}

const BACKDROP = "fixed inset-0 z-50";
const BACKDROP_BG = "bg-black/55";

const sizeMap: Record<string, string> = {
  sm: "w-[min(384px,80vw)]",
  md: "w-[min(448px,80vw)]",
  lg: "w-[min(512px,80vw)]",
  xl: "w-[min(960px,92vw)]",
};

const modalAnim = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
};

const sheetBottomAnim = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
};

const sheetSideAnim = (side: "left" | "right") => ({
  initial: { x: side === "left" ? "-100%" : "100%" },
  animate: { x: 0 },
  exit: { x: side === "left" ? "-100%" : "100%" },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
});

export function Overlay({
  open,
  onClose,
  children,
  title,
  variant = "modal",
  size = "md",
  bare = false,
  showHandle = false,
  panelClassName,
}: Props) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const trapRef = useFocusTrap(open);
  const [visible, setVisible] = useState(open);
  const startY = useRef(0);
  const dragging = useRef(false);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);

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
    if (variant === "sheet-bottom") {
      startY.current = e.clientY;
      dragging.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || variant !== "sheet-bottom") return;
    if (e.clientY - startY.current > 80) {
      dragging.current = false;
      onClose();
    }
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  const closeLabel = t("common.aria_close") as string;

  if (!visible && !open) return null;

  const effectiveVariant = isMobile && variant !== "drawer" ? "sheet-bottom" : variant;

  const isModal = effectiveVariant === "modal" || effectiveVariant === "drawer";

  const panelClasses = isModal
    ? `bg-elevated border-border rounded-xl shadow-xl ${sizeMap[size]} max-h-[85vh] h-full overflow-hidden flex flex-col ${panelClassName ?? ""}`
    : effectiveVariant === "sheet-bottom"
      ? "bg-elevated border-t border-border rounded-t-sheet max-h-[85vh] h-auto overflow-auto scrollbar-thin"
      : `bg-elevated border-border w-[80vw] ${size === 'lg' ? 'max-w-sidebar-wide' : 'max-w-sidebar'} h-auto max-h-[85vh] overflow-auto scrollbar-thin ${
          effectiveVariant === "sheet-left" ? "border-r" : "border-l"
        } ${panelClassName ?? ""}`;

  const anim =
    isModal
      ? modalAnim
      : effectiveVariant === "sheet-bottom"
        ? sheetBottomAnim
        : sheetSideAnim(effectiveVariant === "sheet-left" ? "left" : "right");

  const positionClasses = isModal
    ? "inset-0 flex items-center justify-center p-4"
    : effectiveVariant === "sheet-bottom"
      ? "inset-x-0 bottom-0"
      : effectiveVariant === "sheet-left"
        ? "inset-y-0 left-0"
        : "inset-y-0 right-0";

  return (
    <AnimatePresence onExitComplete={() => setVisible(false)}>
      {open && (
        <div className={BACKDROP}>
          <motion.div
            className={`absolute inset-0 ${BACKDROP_BG}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={trapRef}
            className={`absolute ${positionClasses} z-50`}
            {...anim}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div
              className={panelClasses}
              onClick={(e) => e.stopPropagation()}
            >
              {showHandle && effectiveVariant === "sheet-bottom" && (
                <div className="flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
                  <div className="w-10 h-1 rounded-full bg-muted/40" />
                </div>
              )}
              {title && (
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                  <h2 className="text-sm font-semibold text-foreground m-0">{title}</h2>
                  <button
                    className="flex items-center justify-center w-7 h-7 bg-transparent border-none text-muted cursor-pointer hover:text-foreground hover:bg-white/5 transition-colors rounded-md focus-visible:ring-2 focus-visible:ring-accent outline-none"
                    onClick={onClose}
                    aria-label={closeLabel}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              <div className={bare ? "flex-1 overflow-hidden min-h-0" : "flex-1 overflow-y-auto p-5 scrollbar-thin"}>
                {children}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
