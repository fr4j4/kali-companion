import { type ButtonHTMLAttributes, forwardRef } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  active?: boolean;
}

const sizeClass = {
  sm: "w-8 h-8 rounded-lg",
  md: "w-10 h-10 rounded-lg",
  lg: "w-12 h-12 rounded-xl",
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ size = "md", active = false, className = "", disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={`inline-flex items-center justify-center border border-border bg-transparent text-foreground cursor-pointer transition-[background-color,border-color,transform,opacity] hover:bg-elevated active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
        sizeClass[size]
      } ${active ? "bg-accent-dim border-accent" : ""} ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      } ${className}`}
      {...rest}
    />
  ),
);
IconButton.displayName = "IconButton";
