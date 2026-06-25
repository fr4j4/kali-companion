import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThoughtCloudSVG } from "./ThoughtCloudSVG";
import { useThoughtCloudDrag } from "./useThoughtCloudDrag";
import {
  mergeThoughtCloudConfig,
  type ThoughtCloudConfig,
  type DistributionMode,
} from "./ThoughtCloudConfig";

interface ThoughtCloudProps {
  reasoning: string;
  isStreaming?: boolean;
  className?: string;
  config?: Partial<ThoughtCloudConfig>;
}

export function ThoughtCloud({
  reasoning,
  isStreaming,
  className = "",
  config: override,
}: ThoughtCloudProps) {
  const { t } = useTranslation();
  const cfg = mergeThoughtCloudConfig(override);

  const [expanded, setExpanded] = useState(false);
  const [calculatedFontSize, setCalculatedFontSize] = useState(cfg.maxFontSize);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Modo activo según estado.
  const mode: DistributionMode = expanded ? cfg.expandedMode : cfg.collapsedMode;

  // Dimensiones del wrapper según estado.
  const w = expanded ? cfg.expandedWidth : cfg.collapsedWidth;
  const h = expanded ? cfg.expandedHeight : cfg.collapsedHeight;

  const { placement, dragging, onPointerDown, wasDrag } = useThoughtCloudDrag(w, h, cfg.orbitRadius);

  // Texto a mostrar.
  const lines = reasoning.split("\n\n").filter(Boolean);
  const displayText =
    reasoning.length > cfg.collapsedCharLimit
      ? reasoning.slice(-cfg.collapsedCharLimit) + "…"
      : reasoning;
  const textToShow = expanded ? reasoning : displayText;

  // ── Auto-escala de fuente: medición en DOM oculto replicando shape-outside ──
  useEffect(() => {
    const safeZone = mode === "comic" ? cfg.comicSafeZone : cfg.scrollSafeZone;
    const measureText = expanded ? reasoning : displayText;
    if (!measureText) return;

    const testContainer = document.createElement("div");
    testContainer.style.position = "absolute";
    testContainer.style.visibility = "hidden";
    testContainer.style.width = `${safeZone.width}px`;
    testContainer.style.height = `${safeZone.height}px`;
    testContainer.style.boxSizing = "border-box";
    testContainer.style.padding = "0";

    testContainer.innerHTML = `
      <div id="tc-test-box" style="width: ${safeZone.width}px; height: ${safeZone.height}px; padding-top: ${cfg.offsetTop}px; padding-bottom: ${cfg.offsetBottom}px; box-sizing: border-box; overflow-y: auto;">
        <div style="float: left; width: ${cfg.shapeFloatWidth}%; height: 100%; min-height: ${cfg.shapeFloatMinHeight}px; shape-outside: ${cfg.leftShapePolygon}; shape-margin: ${cfg.shapeMargin}px;"></div>
        <div style="float: right; width: ${cfg.shapeFloatWidth}%; height: 100%; min-height: ${cfg.shapeFloatMinHeight}px; shape-outside: ${cfg.rightShapePolygon}; shape-margin: ${cfg.shapeMargin}px;"></div>
        <div id="tc-test-text" style="line-height: ${cfg.lineHeight}; font-weight: ${cfg.fontWeight}; font-family: inherit; white-space: pre-wrap; word-break: break-word; text-align: ${cfg.textAlign}; padding: 0 ${cfg.offsetSides}px;"></div>
      </div>
    `;

    document.body.appendChild(testContainer);
    const testBox = testContainer.querySelector("#tc-test-box") as HTMLElement;
    const testText = testContainer.querySelector("#tc-test-text") as HTMLElement;
    testText.textContent = measureText;

    let currentSize = cfg.maxFontSize;
    testText.style.fontSize = `${currentSize}px`;

    while (testBox.scrollHeight > safeZone.height && currentSize > cfg.minFontSize) {
      currentSize -= cfg.fontScaleStep;
      testText.style.fontSize = `${currentSize}px`;
    }

    document.body.removeChild(testContainer);
    setCalculatedFontSize(currentSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasoning, expanded, mode, cfg.maxFontSize, cfg.minFontSize, cfg.fontScaleStep, cfg.lineHeight, cfg.shapeMargin, cfg.offsetTop, cfg.offsetBottom, cfg.offsetSides, cfg.shapeFloatWidth, cfg.shapeFloatMinHeight, cfg.leftShapePolygon, cfg.rightShapePolygon, cfg.textAlign]);

  // ── Auto-scroll al final (sólo modo scroll) ──
  useLayoutEffect(() => {
    if (mode === "scroll" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoning, mode]);

  // ── Notifica al avatar la posición del CENTRO de la nube (cada render) ──
  useLayoutEffect(() => {
    const cx = placement.x + w / 2;
    const cy = placement.y + h / 2;
    window.dispatchEvent(
      new CustomEvent("kali:thought-cloud-move", { detail: { x: cx, y: cy } })
    );
  });

  if (!reasoning) return null;

  const handleClick = () => {
    if (wasDrag) return;
    setExpanded((v) => !v);
  };

  // Estilos dinámicos del contenedor scroll.
  const fo = mode === "comic" ? cfg.comicForeign : cfg.scrollForeign;
  const isScrollMode = mode === "scroll";

  const scrollStyle: React.CSSProperties = {
    width: `${fo.width}px`,
    height: `${fo.height}px`,
    boxSizing: "border-box",
    overflowY: isScrollMode ? "auto" : "hidden",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    pointerEvents: "auto",
    WebkitMaskImage: isScrollMode
      ? `linear-gradient(to bottom, transparent 0%, black ${cfg.maskGradientStart}%, black ${cfg.maskGradientEnd}%, transparent 100%)`
      : "none",
    maskImage: isScrollMode
      ? `linear-gradient(to bottom, transparent 0%, black ${cfg.maskGradientStart}%, black ${cfg.maskGradientEnd}%, transparent 100%)`
      : "none",
  };

  const innerStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "100%",
    paddingTop: `${cfg.offsetTop}px`,
    paddingBottom: `${cfg.offsetBottom}px`,
    boxSizing: "border-box",
  };

  const shapeLeftStyle: React.CSSProperties = {
    float: "left",
    width: `${cfg.shapeFloatWidth}%`,
    height: "100%",
    minHeight: `${cfg.shapeFloatMinHeight}px`,
    shapeOutside: cfg.leftShapePolygon,
    shapeMargin: `${cfg.shapeMargin}px`,
  };

  const shapeRightStyle: React.CSSProperties = {
    float: "right",
    width: `${cfg.shapeFloatWidth}%`,
    height: "100%",
    minHeight: `${cfg.shapeFloatMinHeight}px`,
    shapeOutside: cfg.rightShapePolygon,
    shapeMargin: `${cfg.shapeMargin}px`,
  };

  const textWrapStyle: React.CSSProperties = {
    color: cfg.cloudText ?? "var(--cloud-text)",
    fontSize: `${calculatedFontSize}px`,
    lineHeight: cfg.lineHeight,
    fontWeight: cfg.fontWeight,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
    textAlign: cfg.textAlign,
    padding: `0 ${cfg.offsetSides}px`,
    transition: "font-size 0.15s ease",
  };

  const cursorColor = cfg.cursorColor ?? "var(--accent)";

  return (
    <motion.div
      className={`thought-cloud ${isStreaming ? "thought-cloud-streaming" : ""} ${
        dragging ? "thought-cloud-dragging" : ""
      } ${expanded ? "thought-cloud-expanded" : ""} ${className}`}
      style={{ x: placement.mx, y: placement.my, width: w, height: h }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.3, width: { duration: 0.3 }, height: { duration: 0.3 } }}
      onPointerDown={onPointerDown}
      onClick={handleClick}
    >
      <div
        className={`thought-cloud-breathing-wrap ${
          isStreaming === true && cfg.breathingEnabled ? "thought-cloud-breathing" : ""
        }`}
      >
        <ThoughtCloudSVG pointingAngle={placement.pointingAngle} isStreaming={isStreaming} mode={mode} config={cfg}>
        <div ref={scrollRef} className="thought-cloud-scroll" style={scrollStyle}>
          <div className="thought-cloud-inner" style={innerStyle}>
            <div className="thought-cloud-shape-left" style={shapeLeftStyle} />
            <div className="thought-cloud-shape-right" style={shapeRightStyle} />

            <div className="thought-cloud-text-wrap" style={textWrapStyle}>
              {/* Header */}
              <div className="thought-cloud-header">
                <Brain size={12} className="thought-cloud-brain" />
                <span className="thought-cloud-label">
                  {isStreaming ? t("reasoning.thinking") : t("reasoning.thought")}
                </span>
                {!isStreaming && (
                  <ChevronUp
                    size={12}
                    className={`thought-cloud-expand-icon ${expanded ? "opacity-100" : "opacity-50"}`}
                  />
                )}
              </div>

              {/* Texto */}
              <div className="thought-cloud-text-body">
                {isStreaming ? (
                  <span>
                    {textToShow}
                    <span
                      className="thought-cloud-cursor"
                      style={{
                        display: "inline-block",
                        width: `${cfg.cursorWidth}px`,
                        height: `${cfg.cursorHeight}em`,
                        background: cursorColor,
                        marginLeft: "2px",
                        verticalAlign: "text-bottom",
                      }}
                    />
                  </span>
                ) : (
                  <span>
                    {expanded
                      ? lines.map((l, i) => (
                          <p key={i} className="thought-cloud-line">
                            {l}
                          </p>
                        ))
                      : textToShow}
                  </span>
                )}
              </div>

              {/* Botón cerrar (sólo expandido) */}
              <AnimatePresence>
                {expanded && (
                  <motion.button
                    className="thought-cloud-close"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(false);
                    }}
                    aria-label={t("stage.collapse") as string}
                  >
                    <ChevronDown size={16} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </ThoughtCloudSVG>
      </div>
    </motion.div>
  );
}