import type { CSSProperties, ReactNode, RefObject } from "react";

interface GameShellProps {
  containerRef: RefObject<HTMLDivElement>;
  isMaximized?: boolean;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  ready: boolean;
  padding?: number;
  className?: string;
  children: ReactNode;
}

export function GameShell({
  containerRef,
  isMaximized,
  naturalWidth,
  naturalHeight,
  scale,
  offsetX,
  offsetY,
  ready,
  padding = 12,
  className = "",
  children,
}: GameShellProps) {
  return (
    <div
      ref={containerRef}
      className="flex-1 w-full relative select-none overflow-hidden"
      style={{ backgroundColor: isMaximized ? "#000" : "var(--game-bg)" }}
    >
      <div
        className={`absolute top-0 left-0 border-2 rounded-2xl ${className}`}
        style={{
          width: naturalWidth,
          height: naturalHeight,
          padding,
          backgroundColor: "var(--game-panel)",
          borderColor: "var(--game-border)",
          boxShadow:
            "0 0 calc(24px * var(--fx-glow-scale)) var(--game-border-glow), inset 0 0 18px rgba(56, 189, 248, 0.05)",
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          transformOrigin: "top left",
          visibility: ready ? "visible" : "hidden",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface GameButtonProps {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function GameButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  style,
}: GameButtonProps) {
  const colors = {
    primary: {
      backgroundColor: "var(--game-primary)",
      color: "#020617",
      boxShadow: "0 0 calc(14px * var(--fx-glow-scale)) var(--game-primary-glow)",
      border: "1px solid transparent",
    },
    secondary: {
      backgroundColor: "var(--game-border)",
      color: "var(--game-text)",
      border: "1px solid var(--game-primary)",
      boxShadow: "none",
    },
    danger: {
      backgroundColor: "var(--game-danger-bg)",
      color: "var(--game-text)",
      border: "1px solid var(--game-danger)",
      boxShadow: "none",
    },
  } satisfies Record<string, CSSProperties>;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2 rounded-lg text-xs tracking-wider font-game transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none ${
        disabled ? "opacity-50 cursor-not-allowed" : "hover:brightness-110 hover:scale-105"
      } ${className}`}
      style={{ ...colors[variant], ...style }}
    >
      {children}
    </button>
  );
}

interface GameOverlayProps {
  title: string;
  tone?: "primary" | "danger" | "secondary";
  icon?: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  zIndex?: number;
}

export function GameOverlay({
  title,
  tone = "primary",
  icon,
  subtitle,
  footer,
  children,
  zIndex = 10,
}: GameOverlayProps) {
  const color =
    tone === "danger"
      ? "var(--game-danger)"
      : tone === "secondary"
        ? "var(--game-secondary)"
        : "var(--game-primary)";

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center rounded-xl backdrop-blur-[2px] bg-[#02040a]/90"
      style={{ zIndex }}
    >
      {icon && (
        <span
          className="text-5xl mb-3"
          style={{ filter: "drop-shadow(0 0 calc(14px * var(--fx-glow-scale)) var(--game-primary-glow))" }}
        >
          {icon}
        </span>
      )}
      <h2 className="font-game text-lg mb-1 tracking-wider text-center px-4" style={{ color }}>
        {title}
      </h2>
      {subtitle && (
        <div className="font-game text-xs mb-4 text-center px-6" style={{ color: "var(--game-muted)" }}>
          {subtitle}
        </div>
      )}
      {children}
      {footer && (
        <div className="font-game text-[9px] mt-4 text-center px-6" style={{ color: "var(--game-border)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

export function GameHud({ children, width, className = "" }: { children: ReactNode; width: number; className?: string }) {
  return (
    <div
      className={`flex items-end justify-between px-1 pb-3 ${className}`}
      style={{ width, minHeight: 46, flex: "0 0 auto", gap: 12 }}
    >
      {children}
    </div>
  );
}

export function GameStatusBadge({ children, tone = "primary" }: { children: ReactNode; tone?: "primary" | "secondary" }) {
  return (
    <div
      className="px-2 py-1 rounded-md text-[9px] font-game"
      style={{
        backgroundColor: "var(--game-panel-2)",
        color: tone === "primary" ? "var(--game-primary)" : "var(--game-secondary)",
        boxShadow: `0 0 calc(8px * var(--fx-glow-scale)) ${
          tone === "primary" ? "var(--game-primary-glow)" : "var(--game-secondary-glow)"
        }`,
      }}
    >
      {children}
    </div>
  );
}

export function GameSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabledValue,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabledValue?: (value: T) => boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {options.map((option) => {
        const active = value === option.value;
        const disabled = disabledValue?.(option.value) ?? false;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className="px-3 py-2 rounded-md text-[10px] font-game transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:brightness-110 enabled:hover:scale-105"
            style={{
              backgroundColor: active ? "var(--game-primary)" : "var(--game-panel-2)",
              color: active ? "#020617" : "var(--game-muted)",
              boxShadow: active ? "0 0 calc(12px * var(--fx-glow-scale)) var(--game-primary-glow)" : "none",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
