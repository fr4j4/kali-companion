// IconButton — square icon-only button used by the HUD and Dock.

import { type ButtonHTMLAttributes, forwardRef } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  active?: boolean;
}

const sizeClass = {
  sm: "w-8 h-8 rounded-lg",
  md: "w-10 h-10 rounded-[12px]",
  lg: "w-12 h-12 rounded-[14px]",
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ size = "md", active = false, className = "", ...rest }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center border border-border bg-transparent text-foreground cursor-pointer transition-[background-color,border-color,transform] hover:bg-elevated active:scale-95 ${
        sizeClass[size]
      } ${active ? "bg-accent-dim border-accent" : ""} ${className}`}
      {...rest}
    />
  ),
);
IconButton.displayName = "IconButton";