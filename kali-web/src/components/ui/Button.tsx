// Button — shared primary/secondary/ghost button primitive.

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-white border-none hover:brightness-110",
  secondary: "bg-surface text-foreground border border-border hover:bg-elevated",
  ghost: "bg-transparent text-foreground border border-border hover:bg-elevated",
  danger: "bg-err text-white border-none hover:brightness-110",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "secondary", className = "", ...rest }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-sm cursor-pointer transition-[filter,background-color,border-color] max-lg:min-h-[44px] ${variantClass[variant]} ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = "Button";