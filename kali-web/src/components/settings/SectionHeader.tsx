import type { ReactNode } from "react";
import type { LucideProps } from "lucide-react";

interface SectionHeaderProps {
  icon: React.ComponentType<LucideProps>;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function SectionHeader({ icon: Icon, title, description, children }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-accent shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
