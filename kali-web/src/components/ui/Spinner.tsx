// Spinner — small rotating indicator.

import { Loader2 } from "lucide-react";

interface Props {
  size?: number;
  className?: string;
}

export function Spinner({ size = 18, className = "" }: Props) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}