import { useRef, useCallback, useState } from "react";
import { startDrag, startResize, type ResizeEdge } from "../workspace/useDragResize";
import { X, ChevronDown, ChevronRight, Bug, Play, GripVertical, ChevronUp } from "lucide-react";
import { useDebug } from "../hooks/useDebug";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}

function Section({ title, children, defaultOpen = true, forceOpen }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen !== undefined ? forceOpen : open;
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-white/5 hover:bg-white/10 transition text-sm font-medium text-fg/80"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {isOpen && <div className="p-2 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "accent" | "success" | "error";
}

function Button({ onClick, children, variant = "default" }: ButtonProps) {
  const base = "px-2 py-1 text-xs rounded-md transition hover:brightness-110 disabled:opacity-50";
  const colors = {
    default: "bg-white/10 hover:bg-white/15 text-fg/80",
    accent: "bg-accent/20 hover:bg-accent/30 text-accent",
    success: "bg-green-500/20 hover:bg-green-500/30 text-green-400",
    error: "bg-red-500/20 hover:bg-red-500/30 text-red-400",
  };
  return (
    <button onClick={onClick} className={`${base} ${colors[variant]}`}>
      {children}
    </button>
  );
}

interface Props {
  onClose: () => void;
  client: { simulate: (payload: unknown) => void; send: (payload: Record<string, unknown>) => void } | null;
}

const RESIZE_HANDLES: { edge: ResizeEdge; className: string; label: string }[] = [
  { edge: "n", className: "aw-handle-n", label: "Redimensionar arriba" },
  { edge: "s", className: "aw-handle-s", label: "Redimensionar abajo" },
  { edge: "e", className: "aw-handle-e", label: "Redimensionar derecha" },
  { edge: "w", className: "aw-handle-w", label: "Redimensionar izquierda" },
  { edge: "ne", className: "aw-handle-ne", label: "Redimensionar noreste" },
  { edge: "nw", className: "aw-handle-nw", label: "Redimensionar noroeste" },
  { edge: "se", className: "aw-handle-se", label: "Redimensionar sureste" },
  { edge: "sw", className: "aw-handle-sw", label: "Redimensionar southwest" },
];

export function DebugPad({ onClose, client }: Props) {
  const debug = useDebug(client);
  const [ttsText, setTtsText] = useState("");
  const [allExpanded, setAllExpanded] = useState(true);
  const [focused, setFocused] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: window.innerWidth - 400, y: window.innerHeight - 500 });
  const [size, setSize] = useState({ width: 384, height: 450 });

  const expandAll = () => setAllExpanded(true);
  const collapseAll = () => setAllExpanded(false);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setFocused(true);
    const el = elRef.current;
    if (!el) return;
    startDrag({
      id: -999,
      el,
      startPos: position,
      startMouse: { x: e.clientX, y: e.clientY },
      onMove: (_id, pos) => setPosition(pos),
      onEnd: () => {},
      otherWindows: [],
      shiftHeld: () => e.shiftKey,
    });
  }, [position]);

  const handleResizeStart = useCallback((e: React.PointerEvent, edge: ResizeEdge) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocused(true);
    const el = elRef.current;
    if (!el) return;
    startResize({
      id: -999,
      el,
      edge,
      pointerId: e.pointerId,
      startSize: { width: size.width, height: size.height },
      startPos: position,
      startMouse: { x: e.clientX, y: e.clientY },
      minW: 320,
      minH: 300,
      onResize: (_id, s) => setSize({ width: s.width, height: s.height ?? 300 }),
    });
  }, [size, position]);

  return (
    <div
      ref={elRef}
      className={`fixed z-50 aw ${focused ? "focused" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
      onPointerDown={() => setFocused(true)}
    >
      <div className="glass-strong rounded-xl shadow-2xl border-2 border-yellow-500/40 flex flex-col h-full">
        <div
          ref={headerRef}
          onPointerDown={handleDragStart}
          className="px-3 py-2 flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-yellow-500/10 to-transparent shrink-0 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2">
            <GripVertical size={14} className="text-yellow-500/60" />
            <Bug size={14} className="text-yellow-500" />
            <span className="text-sm font-medium text-fg">Debug</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="p-1 rounded hover:bg-white/10 transition text-muted hover:text-fg"
              title="Expand all"
            >
              <ChevronDown size={14} />
            </button>
            <button
              onClick={collapseAll}
              className="p-1 rounded hover:bg-white/10 transition text-muted hover:text-fg"
              title="Collapse all"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-red-500/20 text-muted hover:text-red-300 transition"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-3 space-y-2">
            <Section title="Chat">
              <Button onClick={() => debug.simulateUserMessage("Mensaje de prueba del usuario")}>Msg Usuario</Button>
              <Button onClick={() => debug.simulateAssistantMessage("Mensaje de prueba del asistente")}>Msg Asistente</Button>
              <Button onClick={() => debug.simulateStreamStart()}>Msg Streaming</Button>
              <Button onClick={() => debug.simulateAssistantComplete()}>Completar</Button>
            </Section>

            <Section title="Pensamiento" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateThinkingStart()}>Iniciar</Button>
              <Button onClick={() => debug.simulateReasoningDelta("Razonando sobre el problema...")}>Delta</Button>
              <Button onClick={() => debug.simulateThinkingEnd()}>Terminar</Button>
            </Section>

            <Section title="Tool" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateToolRunning("bash", { command: "ls -la" })}>Ejecutando</Button>
              <Button variant="success" onClick={() => debug.simulateToolSuccess("bash", { output: "files listed" })}>Éxito</Button>
              <Button variant="error" onClick={() => debug.simulateToolError("bash", "Command failed")}>Error</Button>
            </Section>

            <Section title="Streaming" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateStreamStart()}>Iniciar</Button>
              <Button onClick={() => debug.simulateDelta("Respuesta en streaming...")}>Delta</Button>
              <Button onClick={() => debug.simulateStreamEnd()}>Terminar</Button>
            </Section>

            <Section title="Avatar" forceOpen={allExpanded}>
              <div className="w-full flex flex-wrap gap-1 mb-1">
                <Button onClick={() => debug.setAvatarState("idle")}>Idle</Button>
                <Button onClick={() => debug.setAvatarState("pensando")}>Pensando</Button>
                <Button onClick={() => debug.setAvatarState("escuchando")}>Escuchando</Button>
                <Button onClick={() => debug.setAvatarState("hablando")}>Hablar</Button>
              </div>
              <div className="w-full flex flex-wrap gap-1">
                <Button onClick={() => debug.setAvatarEmotion("normal")}>Normal</Button>
                <Button onClick={() => debug.setAvatarEmotion("feliz")}>Feliz</Button>
                <Button onClick={() => debug.setAvatarEmotion("enojado")}>Enojado</Button>
                <Button onClick={() => debug.setAvatarEmotion("sorprendido")}>Sorprendido</Button>
              </div>
              <div className="w-full flex flex-wrap gap-1 mt-1">
                <Button onClick={() => debug.setAvatarEmotion("ronroneando")}>Ronroneando</Button>
                <Button onClick={() => debug.setAvatarEmotion("confundido")}>Confundido</Button>
                <Button variant="accent" onClick={() => debug.resetAvatarOverride()}>Reset</Button>
              </div>
            </Section>

            <Section title="Jobs" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateJobStart("job1", "code_analysis", {})}>Start</Button>
              <Button onClick={() => debug.simulateJobProgress("job1", 50)}>Progress</Button>
              <Button variant="success" onClick={() => debug.simulateJobDone("job1", "done", { result: "analysis complete" })}>Done OK</Button>
              <Button variant="error" onClick={() => debug.simulateJobDone("job1", "error", undefined, "Analysis failed")}>Done Error</Button>
              <Button onClick={() => debug.simulateJobLog("job1", "Processing file 1...")}>Log</Button>
            </Section>

            <Section title="Artifacts" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateArtifactCreate("art1", "html", "HTML Demo", "<h1>Hello World</h1>")}>HTML</Button>
              <Button onClick={() => debug.simulateArtifactCreate("art2", "markdown", "Markdown Demo", "# Hello\n\nThis is **markdown**")}>Markdown</Button>
              <Button onClick={() => debug.simulateArtifactCreate("art3", "widget", "Widget Demo", '{"type": "chart"}')}>Widget</Button>
              <Button onClick={() => debug.simulateArtifactUpdate("art1", "<h1>Updated Content</h1>")}>Update</Button>
              <Button onClick={() => debug.simulateArtifactClose("art1")}>Close</Button>
            </Section>

            <Section title="TTS" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateTtsAudio(1, 3, "Texto del audio")}>Simular Audio</Button>
              <Button onClick={() => debug.simulateTtsFilterStats(100, 85, "Texto filtrado")}>Filter Stats</Button>
              <div className="w-full flex gap-1.5 mt-1">
                <input
                  type="text"
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Texto para el asistente..."
                  className="flex-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-fg placeholder:text-muted/50 focus:outline-none focus:border-yellow-500/50"
                />
                <Button variant="accent" onClick={() => { if (ttsText) { debug.speakText(ttsText); setTtsText(""); } }}>
                  <Play size={12} />
                </Button>
              </div>
            </Section>

            <Section title="Estado" forceOpen={allExpanded}>
              <Button onClick={() => debug.simulateConsentRequest("file_read", "medium")}>Consent</Button>
              <Button variant="error" onClick={() => debug.simulateError("Error de prueba simulado")}>Error</Button>
              <Button onClick={() => debug.simulateTurnStart()}>Turn Start</Button>
              <Button onClick={() => debug.simulateTurnEnd()}>Turn End</Button>
              <Button onClick={() => debug.simulateTurnEnd(true)}>Cancel</Button>
            </Section>

            <Section title="Utilidades" forceOpen={allExpanded}>
              <Button variant="error" onClick={() => debug.clearAll()}>Limpiar Todo</Button>
            </Section>
          </div>
        </div>
      </div>

      {RESIZE_HANDLES.map(({ edge, className, label }) => (
        <div
          key={edge}
          className={`aw-handle ${className}`}
          onPointerDown={(e) => handleResizeStart(e, edge)}
          aria-label={label}
        />
      ))}
    </div>
  );
}
