import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}

const DEFAULT_BUTTON_CLASSES =
  "w-full bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none transition flex items-center justify-between gap-2 cursor-pointer focus:border-accent-dim";

export function Select({
  value,
  onChange,
  options,
  className = "",
  buttonClassName = "",
  placeholder,
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? value ?? placeholder ?? "";

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const right = rect.left + rect.width;
    const overflow = right - window.innerWidth;
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: overflow > 0 ? rect.left - overflow - 8 : rect.left,
      minWidth: rect.width,
      maxWidth: Math.min(320, window.innerWidth - 16),
      zIndex: 9999,
    });
  }, []);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition, disabled]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
    },
    [onChange],
  );

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    const onScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      handleClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open, handleClose]);

  const mergedButtonClasses = [
    DEFAULT_BUTTON_CLASSES,
    buttonClassName,
    disabled ? "opacity-50 cursor-not-allowed" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={mergedButtonClasses}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open
        && createPortal(
            <div
              ref={dropdownRef}
              style={dropdownStyle}
              className="bg-elevated border border-border rounded-lg shadow-xl overflow-y-auto max-h-60 py-1 z-[9999] scrollbar-thin"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`w-full px-3 py-2 text-sm text-left transition cursor-pointer outline-none ${
                    opt.value === value
                      ? "bg-accent/10 text-accent font-semibold"
                      : "text-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                  onClick={() => handleSelect(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              {options.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted">
                  No options
                </div>
              )}
            </div>,
            document.body,
          )}
    </div>
  );
}
