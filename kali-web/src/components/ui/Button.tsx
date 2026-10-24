import { type ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent border-transparent hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  ghost:
    "bg-transparent text-foreground border border-border hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  danger:
    "bg-err text-white border-transparent hover:brightness-110 focus-visible:ring-2 focus-visible:ring-err focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "secondary", loading = false, className = "", disabled, children, ...rest }, ref) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-sm font-medium cursor-pointer transition-[filter,background-color,border-color,transform,opacity] max-lg:min-h-[44px] active:scale-[0.97] outline-none ${
          isDisabled ? "opacity-50 cursor-not-allowed" : ""
        } ${variantClass[variant]} ${className}`}
        {...rest}
      >
        {loading && <Loader2 size={14} className="animate-spin shrink-0" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
