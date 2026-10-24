import {
  AppWindow, AudioLines, BookOpen, CalendarDays, CircleHelp, Code2, Database, FileText, FolderOpen, Gamepad2, Globe,
  LayoutDashboard, Mic, Monitor, Presentation, ScanEye, Search, SquareKanban, SquareTerminal, StickyNote, Table2,
  Workflow, type LucideIcon,
} from "lucide-react";
import type { NodeId } from "./mapModel";

/** Line icon of each map node. */
export const NODE_ICONS: Record<NodeId, LucideIcon> = {
  research: Search,
  screen: Monitor,
  code: Code2,
  terminal: SquareTerminal,
  files: FolderOpen,
  desktop: AppWindow,
  game: Gamepad2,
  voice: Mic,
  memory: Database,
  web: Globe,
  document: FileText,
  sheet: Table2,
  dashboard: LayoutDashboard,
  diagram: Workflow,
  viewer: ScanEye,
  tasks: SquareKanban,
  notes: StickyNote,
  slides: Presentation,
  calendar: CalendarDays,
  quiz: CircleHelp,
  media: AudioLines,
  sources: BookOpen,
};
