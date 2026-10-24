import type { ReactNode } from "react";

interface SettingsCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsCard({ title, description, children, className = "" }: SettingsCardProps) {
  return (
    <div className={`flex flex-col gap-3 p-4 rounded-xl bg-surface border border-border ${className}`}>
      {(title || description) && (
        <div className="flex flex-col gap-0.5">
          {title && (
            <h3 className="text-[13px] font-semibold text-foreground">
              {title}
            </h3>
          )}
          {description && <p className="text-[11px] text-muted">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
