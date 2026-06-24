/**
 * workspace/types.ts — Shared types for the spatial workspace engine.
 *
 * Every artifact from the backend becomes a draggable ArtifactWindow on the
 * canvas.  The workspace engine manages creation, positioning, focus, tethers,
 * undo/redo, multi-select, and persistence.
 */

import type { ArtifactEvent } from "../lib/protocol";

/** All possible window types the canvas can render. */
export type WindowType =
  | "code"
  | "link"
  | "mermaid"
  | "qr"
  | "chart"
  | "json"
  | "terminal"
  | "checklist"
  | "quiz"
  | "diff"
  | "table"
  | "controls"
  | "html"
  | "widget"
  | "entity"
  | "resource"
  | "place"
  | "media"
  | "document"
  | "image";

/** Position on the canvas (px). */
export interface Position {
  x: number;
  y: number;
}

/** Size of a window (px). */
export interface Size {
  width: number;
  height: number | null;
}

/** A single window on the canvas. */
export interface ArtifactWindowData {
  /** Unique workspace id (auto-incremented). */
  id: number;
  /** Reference to the backend ArtifactEvent id, if applicable. */
  artifactId?: string;
  /** Renderer type — determines which widget component to mount. */
  type: WindowType;
  /** Title shown in the window header. */
  title: string;
  /** Emoji or short icon string. */
  icon: string;
  /** Canvas position (top-left corner). */
  position: Position;
  /** Window size. `height: null` means auto-height. */
  size: Size;
  /** z-index for stacking order. */
  zIndex: number;
  /** Whether the window is closed (hidden, recoverable from drawer). */
  closed: boolean;
  /** Whether the window is minimized (in the dock bar). */
  minimized: boolean;
  /** Whether the window is maximized (fullscreen). */
  maximized: boolean;
  /** Whether the window currently has focus. */
  focused: boolean;
  /** Raw content payload from the backend (ArtifactEvent or custom data). */
  content: unknown;
  /** Creation timestamp. */
  timestamp: Date;
  /** Tether SVG path `d` attribute (computed by TetherLayer). */
  tetherPath?: string;
  /** Tether stroke color (derived from window type). */
  tetherColor?: string;
}

/** A tether connects the avatar center to a window center. */
export interface TetherData {
  windowId: number;
  path: string;
  color: string;
}

/** Undo/redo action variants. */
export type UndoAction =
  | { type: "create"; windowId: number }
  | { type: "close"; windowId: number }
  | { type: "move"; windowId: number; prevPos: Position; newPos: Position }
  | { type: "resize"; windowId: number; prevSize: Size; newSize: Size }
  | { type: "clear-all"; windows: ArtifactWindowData[] };

/** The full API surface returned by `useWorkspace`. */
export interface WorkspaceAPI {
  windows: ArtifactWindowData[];
  gridMode: boolean;
  selectedIds: Set<number>;
  audioEnabled: boolean;
  createWindow: (type: WindowType, opts?: Partial<CreateWindowOpts>) => number;
  closeWindow: (id: number) => void;
  restoreWindow: (id: number) => void;
  duplicateWindow: (id: number) => void;
  focusWindow: (id: number) => void;
  focusLast: () => void;
  clearAll: () => void;
  toggleGrid: () => void;
  arrangeOrbit: () => void;
  networkPulse: () => void;
  toggleAudio: () => void;
  undo: () => void;
  redo: () => void;
  saveWorkspace: () => void;
  moveWindow: (id: number, pos: Position) => void;
  resizeWindow: (id: number, size: Size) => void;
  toggleSelect: (id: number) => void;
  clearSelection: () => void;
  syncArtifact: (event: ArtifactEvent) => void;
  toggleMinimize: (id: number) => void;
  toggleMaximize: (id: number) => void;
}

/** Options for creating a window. */
export interface CreateWindowOpts {
  type: WindowType;
  title: string;
  icon: string;
  width: number;
  height: number | null;
  content: unknown;
  artifactId?: string;
  resizable: boolean;
  minW: number;
  minH: number;
}

/** Tether color mapping by window type. */
export const TETHER_COLORS: Record<string, string> = {
  entity: "#ef4444",
  resource: "#eab308",
  place: "#06b6d4",
  media: "#06b6d4",
  document: "#22d3ee",
  code: "#10b981",
  qr: "#10b981",
  image: "#8b5cf6",
  mermaid: "#22d3ee",
  link: "#22d3ee",
  chart: "#22d3ee",
  json: "#22d3ee",
  terminal: "#22d3ee",
  checklist: "#22d3ee",
  quiz: "#22d3ee",
  diff: "#22d3ee",
  table: "#22d3ee",
  controls: "#22d3ee",
  html: "#22d3ee",
  widget: "#22d3ee",
};

/** Default window dimensions by type. */
export const DEFAULT_SIZES: Record<WindowType, { width: number; height: number | null }> = {
  code: { width: 380, height: 360 },
  link: { width: 300, height: null },
  mermaid: { width: 400, height: 380 },
  qr: { width: 260, height: null },
  chart: { width: 360, height: 340 },
  json: { width: 360, height: 420 },
  terminal: { width: 380, height: 360 },
  checklist: { width: 300, height: null },
  quiz: { width: 320, height: null },
  diff: { width: 380, height: 340 },
  table: { width: 380, height: 340 },
  controls: { width: 280, height: null },
  html: { width: 400, height: 400 },
  widget: { width: 340, height: null },
  entity: { width: 340, height: null },
  resource: { width: 300, height: null },
  place: { width: 420, height: null },
  media: { width: 320, height: null },
  document: { width: 420, height: 500 },
  image: { width: 260, height: null },
};

/** Icons (emoji) by window type. */
export const WINDOW_ICONS: Record<WindowType, string> = {
  code: "\u{1F4BB}",
  link: "\u{1F517}",
  mermaid: "\u{1F500}",
  qr: "\u{1F4F1}",
  chart: "\u{1F4CA}",
  json: "\u{1F5C2}\uFE0F",
  terminal: "\u{1F5A5}\uFE0F",
  checklist: "\u2705",
  quiz: "\u2753",
  diff: "\u{1F527}",
  table: "\u{1F4CB}",
  controls: "\u{1F39A}\uFE0F",
  html: "\u{1F310}",
  widget: "\u{1F4E6}",
  entity: "\u{1F6E1}\uFE0F",
  resource: "\u26A1",
  place: "\u{1F5FA}\uFE0F",
  media: "\u{1F3B5}",
  document: "\u{1F4DD}",
  image: "\u{1F5BC}\uFE0F",
};