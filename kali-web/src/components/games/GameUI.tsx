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
  size?: "md" | "sm";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function GameButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
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
      className={`${size === "sm" ? "px-3 py-2 text-[10px] min-h-11" : "px-5 py-2 text-xs"} rounded-lg tracking-wider font-game transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none ${
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

export function GameHudStat({
  label,
  value,
  tone = "primary",
  minWidth,
}: {
  label: string;
  value: ReactNode;
  tone?: "primary" | "secondary";
  minWidth?: number;
}) {
  const color = tone === "primary" ? "var(--game-primary)" : "var(--game-secondary)";
  const glow = tone === "primary" ? "var(--game-primary-glow)" : "var(--game-secondary-glow)";
  return (
    <div
      className="flex flex-col items-center justify-center px-2 py-1 rounded-md"
      style={{
        backgroundColor: "var(--game-panel-2)",
        boxShadow: `0 0 calc(8px * var(--fx-glow-scale)) ${glow}`,
        minWidth,
        boxSizing: "border-box",
      }}
    >
      <span className="text-[8px] font-game" style={{ color, lineHeight: 1.2 }}>
        {label}
      </span>
      <span className="text-xs font-game" style={{ color: "var(--game-text)", lineHeight: 1.2 }}>
        {value}
      </span>
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

export function GameTitleScreen({
  icon,
  title,
  subtitle,
  controls,
  primaryAction,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  primaryAction?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <GameOverlay title={title} subtitle={subtitle} icon={icon} footer={footer}>
      {controls && <div className="flex flex-col items-center gap-3 mb-6">{controls}</div>}
      {primaryAction}
    </GameOverlay>
  );
}

export function GamePauseScreen({
  title = "PAUSED",
  actions,
  footer,
}: {
  title?: string;
  actions: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <GameOverlay title={title} footer={footer}>
      <div className="flex flex-col gap-3">{actions}</div>
    </GameOverlay>
  );
}

export function GameResultScreen({
  title,
  tone = "primary",
  subtitle,
  actions,
  footer,
}: {
  title: string;
  tone?: "primary" | "danger" | "secondary";
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <GameOverlay title={title} tone={tone} subtitle={subtitle} footer={footer}>
      {actions && <div className="flex flex-col gap-3">{actions}</div>}
    </GameOverlay>
  );
}

export function TouchDPad({
  onDirection,
  placement = "bottom-center",
  bottomOffset = 110,
}: {
  onDirection: (direction: "UP" | "DOWN" | "LEFT" | "RIGHT") => void;
  placement?: "bottom-center" | "top-right" | "top-left" | "inline-bottom";
  bottomOffset?: number;
}) {
  if (placement === "inline-bottom") {
    return (
      <div className="mt-4 w-full flex justify-center pointer-events-auto">
        <div className="grid grid-cols-3 gap-2">
          <div />
          <button type="button" className="min-w-11 min-h-11 w-11 h-11 rounded-xl border border-accent/30 bg-elevated/90 text-foreground text-lg font-bold flex items-center justify-center active:scale-95 active:bg-accent/20" onClick={() => onDirection("UP")} aria-label="Move up">↑</button>
          <div />
          <button type="button" className="min-w-11 min-h-11 w-11 h-11 rounded-xl border border-accent/30 bg-elevated/90 text-foreground text-lg font-bold flex items-center justify-center active:scale-95 active:bg-accent/20" onClick={() => onDirection("LEFT")} aria-label="Move left">←</button>
          <button type="button" className="min-w-11 min-h-11 w-11 h-11 rounded-xl border border-accent/30 bg-elevated/90 text-foreground text-lg font-bold flex items-center justify-center active:scale-95 active:bg-accent/20" onClick={() => onDirection("DOWN")} aria-label="Move down">↓</button>
          <button type="button" className="min-w-11 min-h-11 w-11 h-11 rounded-xl border border-accent/30 bg-elevated/90 text-foreground text-lg font-bold flex items-center justify-center active:scale-95 active:bg-accent/20" onClick={() => onDirection("RIGHT")} aria-label="Move right">→</button>
        </div>
      </div>
    );
  }

  const placementClass =
    placement === "top-right"
      ? "top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))]"
      : placement === "top-left"
        ? "top-[max(12px,env(safe-area-inset-top))] left-[max(12px,env(safe-area-inset-left))]"
        : `bottom-[calc(${bottomOffset}px + env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2`;
  const buttonClassName =
    "min-w-11 min-h-11 w-11 h-11 rounded-xl border border-accent/30 bg-elevated/90 text-foreground text-lg font-bold flex items-center justify-center active:scale-95 active:bg-accent/20";

  return (
    <div className={`absolute ${placementClass} z-20 pointer-events-auto`}>
      <div className="grid grid-cols-3 gap-2">
        <div />
        <button type="button" className={buttonClassName} onClick={() => onDirection("UP")} aria-label="Move up">↑</button>
        <div />
        <button type="button" className={buttonClassName} onClick={() => onDirection("LEFT")} aria-label="Move left">←</button>
        <button type="button" className={buttonClassName} onClick={() => onDirection("DOWN")} aria-label="Move down">↓</button>
        <button type="button" className={buttonClassName} onClick={() => onDirection("RIGHT")} aria-label="Move right">→</button>
      </div>
    </div>
  );
}

export function GameMobileActionBar({
  actions,
  placement = "bottom-center",
  bottomOffset = 116,
}: {
  actions: ReactNode;
  placement?: "bottom-center" | "top-right" | "top-left" | "inline-bottom";
  bottomOffset?: number;
}) {
  if (placement === "inline-bottom") {
    return (
      <div className="mt-4 w-full flex justify-center pointer-events-auto">
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-panel/90 px-2 py-2 shadow-lg backdrop-blur-md">
          {actions}
        </div>
      </div>
    );
  }

  const placementClass =
    placement === "top-right"
      ? "top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))]"
      : placement === "top-left"
        ? "top-[max(12px,env(safe-area-inset-top))] left-[max(12px,env(safe-area-inset-left))]"
        : `bottom-[calc(${bottomOffset}px + env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2`;

  return (
    <div className={`absolute ${placementClass} z-20 pointer-events-auto`}>
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-panel/90 px-2 py-2 shadow-lg backdrop-blur-md">
        {actions}
      </div>
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
