# Plan: Rename + Side Panel Infra + Games Debug Panel

**Date:** 2026-07-02
**Status:** Phase 1-3 complete. Phase 4 (HTML console) postponed.

## Overview

Three related changes:

1. **Rename:** `ArtifactWindow` → `KaliWindow`, `ArtifactWindowData` → `WindowData`, `ArtifactCanvas` → `WindowCanvas`, CSS `.aw` → `.kw`
2. **Side Panel Infrastructure:** Generic side panel system where any widget can declare a configurable panel (position left/right/bottom, icon, content)
3. **Games Debug Panel:** The game widget uses the side panel to show the WS/AI protocol debug log

**Backend untouched.** `ArtifactEvent`, `syncArtifact`, `artifactId`, `selected_artifacts`, prompt injection in `server.py` — all unchanged.

---

## Phase 0: Revert Broken State

Restore `GameWindow.tsx` and `TicTacToeView.tsx` to working state before rename.

### Changes

**`kali-web/src/components/games/GameWindow.tsx`**
- Remove title bar logic, `debug` state, `isDebugging` state, toggle button
- Remove `DebugPad` import and usage
- Simplify to plain router: if `mode === "html"` → `<HtmlWidget />`, else if `mode === "game"` → `<TicTacToeView />`

**`kali-web/src/components/games/TicTacToeView.tsx`**
- Remove `className="border-t-0 rounded-b-2xl"`
- Restore `className="rounded-2xl border-2"`

---

## Phase 1: Rename

### 1a. `types.ts` — `ArtifactWindowData` → `WindowData`

Files: `kali-web/src/workspace/types.ts`

Rename interface `ArtifactWindowData` → `WindowData`. No other changes in this file.

### 1b. `windowManager.ts`

Files: `kali-web/src/workspace/windowManager.ts`

Replace all `ArtifactWindowData` references with `WindowData`. The file has ~17 references.

### 1c. `useWorkspace.ts`

Files: `kali-web/src/workspace/useWorkspace.ts`

Replace all `ArtifactWindowData` references with `WindowData`. The file has ~40 references.

### 1d. `Window.tsx` — `ArtifactWindow` → `KaliWindow`

Files: `kali-web/src/stage/Window.tsx` (new name)

Rename:
- File: `ArtifactWindow.tsx` → `Window.tsx`
- `ArtifactWindow` export → `KaliWindow`
- `ArtifactWindowImpl` → `WindowImpl`
- `TetherLayer` → stays `TetherLayer` (already generic name)
- `MinimizeDock` → stays `MinimizeDock`
- `WindowContentRouter` → stays `WindowContentRouter`
- `NeuralCanvas` → stays `NeuralCanvas`
- `DebugPad` → stays `DebugPad`
- Import names update accordingly

### 1e. `ArtifactCanvas.tsx` → `WindowCanvas.tsx`

Files: `kali-web/src/stage/WindowCanvas.tsx` (new name)

Rename:
- File: `ArtifactCanvas.tsx` → `WindowCanvas.tsx`
- `ArtifactCanvas` → `WindowCanvas`
- Import `ArtifactWindow` → `KaliWindow`

### 1f. Update all imports referencing renamed files

Files to check:
- `kali-web/src/stage/Stage.tsx` — imports `ArtifactCanvas`
- `kali-web/src/stage/StageProvider.tsx` — may import `ArtifactWindow`/`ArtifactCanvas`
- Any other file that imports `ArtifactWindow` or `ArtifactCanvas`

### 1g. CSS `.aw` → `.kw`

Files: `kali-web/src/styles.css`

Replace all `.aw-*` class names with `.kw-*`:
- `.aw` → `.kw`
- `.aw-titlebar` → `.kw-titlebar`
- `.aw-title` → `.kw-title`
- `.aw-close` → `.kw-close`
- `.aw-minimize` → `.kw-minimize`
- `.aw-maximize` → `.kw-maximize`
- `.aw-resize` → `.kw-resize`
- `.aw-body` → `.kw-body`
- `.aw-content` → `.kw-content`
- `.aw-tether` → `.kw-tether`
- `.aw-minimize-dock` → `.kw-minimize-dock`
- `.aw-hidden` → `.kw-hidden`
- `.aw-closed` → `.kw-closed`
- `.aw-focus-ring` → `.kw-focus-ring`
- `.aw-dragging` → `.kw-dragging`

Also update any inline `className` references in:
- `Window.tsx` (the component)
- `DebugPad.tsx` (if it uses any `.aw-*` classes)

---

## Phase 2: Side Panel Infrastructure

### 2a. `SidePanelContext.tsx` (new file)

Location: `kali-web/src/stage/SidePanelContext.tsx`

```typescript
interface SidePanelContent {
  icon: React.ReactNode;
  title: string;
  onClear?: () => void;
}

interface SidePanelContextValue {
  setSidePanelContent: (content: SidePanelContent | null) => void;
  clearSidePanel: () => void;
  sidePanelContent: SidePanelContent | null;
}

export const SidePanelContext = createContext<SidePanelContextValue | null>(null);
export const useSidePanel = () => { ... };
```

### 2b. `widgetRegistry.ts` — add `sidePanel` to `WidgetEntry`

Files: `kali-web/src/components/widgets/widgetRegistry.ts`

Add optional `sidePanel` field to `WidgetEntry`:

```typescript
interface SidePanelConfig {
  position: "left" | "right" | "bottom";
  defaultSize: number;       // px
  defaultOpen: boolean;
  minSize: number;            // px
  toggleIcon: React.ReactNode;
}

interface WidgetEntry {
  // ... existing fields ...
  sidePanel?: SidePanelConfig;
}
```

Declare `sidePanel` for `game` widget (position: "right", defaultSize: 320, minSize: 200).
Declare `sidePanel` for `html` widget (position: "bottom", defaultSize: 200, minSize: 100).

### 2c. `Window.tsx` — add wrapper, side panel frame, toggle button, resize handle

Modify the `WindowImpl` component:

1. Wrap the entire window in a `position: relative` div that contains:
   - The existing `.kw` window frame (unchanged)
   - A new `.kw-side-panel` sibling div

2. Add toggle button in `WindowHeader` (always visible, not conditioned on anything):
   ```tsx
   <button
     onClick={toggleSidePanel}
     className="p-1 rounded hover:bg-white/10 text-fg/60 hover:text-fg transition"
     title="Toggle debug panel"
   >
     {panelIcon}
   </button>
   ```

3. Add side panel frame:
   ```tsx
   {sidePanelOpen && (
     <div className={`kw-side-panel kw-side-panel-${position}`}>
       {sidePanelContent?.icon}
       {sidePanelContent?.onClear && (
         <button onClick={sidePanelContent.onClear}>Clear</button>
       )}
     </div>
   )}
   ```

4. Add resize handle on inner border (for the panel):
   ```tsx
   {sidePanelOpen && (
     <div
       className={`kw-side-panel-resize kw-side-panel-resize-${position}`}
       onMouseDown={startPanelResize}
     />
   )}
   ```

5. Add state: `sidePanelOpen`, `sidePanelSize`, `sidePanelPosition`

6. Provide `SidePanelContext` to children via context.

### 2d. `styles.css` — add side panel styles

```css
.kw-side-panel {
  position: absolute;
  background: var(--color-canvas);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.kw-side-panel-right {
  left: 100%;
  top: 0;
  width: var(--panel-width, 320px);
  height: 100%;
  border-left: none;
  border-radius: 0 8px 8px 0;
}

.kw-side-panel-bottom {
  top: 100%;
  left: 0;
  width: 100%;
  height: var(--panel-height, 200px);
  border-top: none;
  border-radius: 0 0 8px 8px;
}

.kw-side-panel-resize {
  position: absolute;
  background: transparent;
}

.kw-side-panel-resize-right {
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  cursor: ew-resize;
}

.kw-side-panel-resize-bottom {
  left: 0;
  top: 0;
  width: 100%;
  height: 4px;
  cursor: ns-resize;
}
```

---

## Phase 3: Games Debug Panel

### 3a. `GameDebugPanel.tsx` (new file)

Location: `kali-web/src/components/games/GameDebugPanel.tsx`

Subscribes to `gameAILogger` singleton. Renders entries in chat format:
- Outgoing (`→`) aligned right, cyan color
- Incoming (`←`) aligned left, purple color

```tsx
export function GameDebugPanel() {
  const [entries, setEntries] = useState<GameAILogEntry[]>([]);

  useEffect(() => {
    const sub = gameAILogger.subscribe((newEntries) => {
      setEntries([...newEntries]);
    });
    return () => sub.unsubscribe();
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-fg/60">WS / AI Log</span>
        <button onClick={() => gameAILogger.clear()}>Clear</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1">
        {entries.map((entry) => (
          <div className={`flex ${entry.direction === "→" ? "justify-end" : "justify-start"}`}>
            <span className={`text-xs ${entry.direction === "→" ? "text-cyan-400" : "text-purple-400"}`}>
              {entry.direction} {entry.type}
            </span>
            <span className="text-xs text-fg/40 ml-2">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3b. `GameWidget.tsx` — register with `SidePanelContext`

Files: `kali-web/src/components/widgets/GameWidget.tsx`

```tsx
const { setSidePanelContent } = useSidePanel();

useEffect(() => {
  setSidePanelContent({
    icon: <GamepadIcon />,
    title: "Game Debug",
    onClear: () => gameAILogger.clear(),
  });
  return () => setSidePanelContent(null);
}, []);
```

### 3c. Verify `gameAILogger` singleton is properly set up

Check: `kali-web/src/games/core/game-ai-logger.ts`

Make sure it exports `gameAILogger` instance and `GameAILogEntry` type.

---

## Phase 4: HTML Console (POSTPONED)

Not in scope for this session. Will be done later.

Requires:
- `console-logger.ts` singleton (separate from `gameAILogger`)
- Extract `ConsolePanel` from `HtmlWidget`
- Migrate `postMessage` handler to subscribe to `console-logger`
- Update `widgetRegistry` for `html` side panel

---

## Files Summary

| File | Action |
|------|--------|
| `kali-web/src/components/games/GameWindow.tsx` | Reverted (simplified) |
| `kali-web/src/components/games/TicTacToeView.tsx` | Reverted (`border-t-0` removed) |
| `kali-web/src/workspace/types.ts` | Renamed `ArtifactWindowData` → `WindowData` |
| `kali-web/src/workspace/windowManager.ts` | Renamed refs |
| `kali-web/src/workspace/useWorkspace.ts` | Renamed refs |
| `kali-web/src/workspace/usePersistence.ts` | Renamed refs |
| `kali-web/src/stage/ArtifactWindow.tsx` | Renamed → `Window.tsx`, `ArtifactWindowImpl` → `WindowImpl`, `ArtifactWindow` → `KaliWindow` |
| `kali-web/src/stage/ArtifactCanvas.tsx` | Renamed → `WindowCanvas.tsx` |
| `kali-web/src/stage/NeuralCanvas.tsx` | Updated imports |
| `kali-web/src/stage/TetherLayer.tsx` | Updated imports/types |
| `kali-web/src/stage/MinimizeDock.tsx` | Updated imports/types |
| `kali-web/src/stage/WindowContentRouter.tsx` | Updated imports/types, comment updated |
| `kali-web/src/stage/DebugPad.tsx` | Updated CSS class refs |
| `kali-web/src/styles.css` | `.aw-*` → `.kw-*` (all), added side panel CSS |
| `kali-web/src/stage/SidePanelContext.tsx` | **NEW** |
| `kali-web/src/components/widgets/widgetRegistry.ts` | **Renamed to `widgetRegistry.tsx`**, added `SidePanelConfig` and `sidePanel` field |
| `kali-web/src/components/widgets/GameWidget.tsx` | Wired up `useSidePanel` |
| `kali-web/src/components/games/GameDebugPanel.tsx` | **NEW** |
| `kali-web/src/games/core/game-ai-logger.ts` | Verified (already existed) |

---

## Constraints

- Side panel is **external** to `.kw` — never changes `.kw` size
- `.kw` has `overflow: clip` — panel is a sibling, not a child
- Panel moves with window when dragged (lives inside wrapper)
- Panel is resizable via handle on inner border
- Toggle button is in `WindowHeader`, always visible
- Chat format: salientes (`→`) right-aligned cyan, entrantes (`←`) left-aligned purple
- `artifactId` stays optional in `WindowData` — no backend changes
- Rename is mechanical: CSS classes in sync, imports updated

---

## Verification

After each phase:
1. `cd kali-web && npx tsc --noEmit` — must be clean
2. Check no remaining `ArtifactWindow`, `ArtifactWindowData`, `ArtifactCanvas`, `.aw-` references

After all phases:
1. Browser test — windows open, drag, resize correctly
2. Games debug panel — entries appear when playing TicTacToe
