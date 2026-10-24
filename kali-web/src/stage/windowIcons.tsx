import {
  Brain, Code2, FileText, Gamepad2, GitCompare, Globe, Image as ImageIcon, Link2,
  ListChecks, MapPin, Music2, Package, PieChart, QrCode, Share2, SlidersHorizontal, Table2, Terminal,
  Braces, Shield, Zap, CircleHelp, type LucideIcon,
} from "lucide-react";
import type { WindowType } from "../workspace/types";

/** Line icon per window type; replaces the emoji so headers read the same on every platform and theme. */
const ICONS: Record<WindowType, LucideIcon> = {
  code: Code2,
  link: Link2,
  mermaid: Share2,
  qr: QrCode,
  chart: PieChart,
  json: Braces,
  terminal: Terminal,
  checklist: ListChecks,
  quiz: CircleHelp,
  diff: GitCompare,
  table: Table2,
  controls: SlidersHorizontal,
  html: Globe,
  widget: Package,
  entity: Shield,
  resource: Zap,
  place: MapPin,
  media: Music2,
  document: FileText,
  image: ImageIcon,
  reasoning: Brain,
  game: Gamepad2,
};

export function WindowTypeIcon({ type, size = 14, className }: { type: WindowType; size?: number; className?: string }) {
  const Icon = ICONS[type] ?? Package;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

