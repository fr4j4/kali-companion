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
  placeholder?: string;
}

export function Select({ value, onChange, options, className = "", placeholder }: SelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? value ?? placeholder ?? "";

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: rect.width,
      zIndex: 9999,
    });
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

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
    const onScroll = () => handleClose();
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

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-fg flex items-center justify-between gap-2 cursor-pointer outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open
        && createPortal(
            <div
              ref={dropdownRef}
              style={dropdownStyle}
              className="bg-elevated border border-border rounded-xl shadow-xl overflow-hidden py-1"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`w-full px-4 py-2.5 text-sm text-left transition cursor-pointer outline-none ${
                    opt.value === value
                      ? "bg-accent/10 text-accent font-semibold"
                      : "text-fg hover:bg-white/5 hover:text-fg"
                  }`}
                  onClick={() => handleSelect(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              {options.length === 0 && (
                <div className="px-4 py-2.5 text-sm text-muted">No options</div>
              )}
            </div>,
            document.body,
          )}
    </div>
  );
}
