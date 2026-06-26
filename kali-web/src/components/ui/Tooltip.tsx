// Tooltip — minimal CSS tooltip via title + a small wrapper for consistent styling.
//
// For now we rely on the native title attribute to avoid adding complexity.
// This wrapper exists so call-sites are uniform and we can swap to a real
// tooltip later without touching call-sites.

import { type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ label, children, side = "top" }: Props) {
  // Native title is used for accessibility; the `side` prop is reserved for
  // a future popper-based implementation.
  void side;
  return (
    <span title={label} className="inline-flex">
      {children}
    </span>
  );
}