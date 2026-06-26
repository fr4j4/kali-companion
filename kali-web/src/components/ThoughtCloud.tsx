import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ThoughtCloudSVG } from "./ThoughtCloudSVG";
import { useThoughtCloudDrag } from "./useThoughtCloudDrag";
import {
  mergeThoughtCloudConfig,
  type ThoughtCloudConfig,
} from "./ThoughtCloudConfig";

type TailPhase = "idle" | "appearing" | "active";

interface ThoughtCloudProps {
  reasoning: string;
  isStreaming?: boolean;
  dimmed?: boolean;
  onDismiss?: () => void;
  onExpand?: () => void;
  className?: string;
  config?: Partial<ThoughtCloudConfig>;
}

export function ThoughtCloud({
  reasoning,
  isStreaming,
  dimmed = false,
  onDismiss,
  onExpand,
  className = "",
  config: override,
}: ThoughtCloudProps) {
  const cfg = mergeThoughtCloudConfig(override);

  const [calculatedFontSize, setCalculatedFontSize] = useState(cfg.maxFontSize);
  const scrollRef = useRef<HTMLDivElement>(null);

  const w = cfg.collapsedWidth;
  const h = cfg.collapsedHeight;

  const { placement, dragging, onPointerDown, wasDrag } = useThoughtCloudDrag(w, h, {
    avatarRingRadius: cfg.avatarRingRadius,
    cloudCenterToTail: cfg.cloudCenterToTail,
    tailGap: cfg.tailGap,
    maxOrbitGap: cfg.maxOrbitGap,
  });

  const displayText =
    reasoning.length > cfg.collapsedCharLimit
      ? reasoning.slice(-cfg.collapsedCharLimit) + "…"
      : reasoning;

  const tailPhase: TailPhase =
    isStreaming && (!reasoning || reasoning.length < 5) ? "appearing" : isStreaming ? "active" : "idle";

  // ── Auto-escala de fuente ──
  useEffect(() => {
    const vbW = cfg.viewBoxWidth;
    const vbH = cfg.viewBoxHeight;
    const scaleX = w / vbW;
    const scaleY = h / vbH;
    const safeZone = cfg.comicSafeZone;
    const effectiveWidth = safeZone.width;
    const effectiveHeight = safeZone.height;
    const measureText = displayText;
    if (!measureText) return;

    const testContainer = document.createElement("div");
    testContainer.style.position = "absolute";
    testContainer.style.visibility = "hidden";
    testContainer.style.width = `${effectiveWidth}px`;
    testContainer.style.height = `${effectiveHeight}px`;
    testContainer.style.boxSizing = "border-box";
    testContainer.style.padding = "0";

    testContainer.innerHTML = `
      <div id="tc-test-box" style="width: ${effectiveWidth}px; height: ${effectiveHeight}px; padding-top: ${cfg.offsetTop}px; padding-bottom: ${cfg.offsetBottom}px; box-sizing: border-box; overflow-y: auto;">
        <div style="float: left; width: ${cfg.shapeFloatWidth}%; height: 100%; min-height: ${cfg.shapeFloatMinHeight}px; shape-outside: ${cfg.leftShapePolygon}; shape-margin: ${cfg.shapeMargin}px;"></div>
        <div style="float: right; width: ${cfg.shapeFloatWidth}%; height: 100%; min-height: ${cfg.shapeFloatMinHeight}px; shape-outside: ${cfg.rightShapePolygon}; shape-margin: ${cfg.shapeMargin}px;"></div>
        <div id="tc-test-text" style="line-height: ${cfg.lineHeight}; font-weight: ${cfg.fontWeight}; font-family: inherit; white-space: pre-wrap; word-break: break-word; text-align: ${cfg.textAlign}; padding: 0 ${cfg.offsetSides}px;"></div>
      </div>
    `;

    document.body.appendChild(testContainer);
    const testBox = testContainer.querySelector("#tc-test-box") as HTMLElement;
    const testText = testContainer.querySelector("#tc-test-text") as HTMLElement;
    testText.textContent = measureText;

    const scale = Math.min(scaleX, scaleY);
    let currentSize = cfg.maxFontSize / scale;
    testText.style.fontSize = `${currentSize}px`;

    while (testBox.scrollHeight > effectiveHeight && currentSize > cfg.minFontSize / scale) {
      currentSize -= cfg.fontScaleStep / scale;
      testText.style.fontSize = `${currentSize}px`;
    }

    document.body.removeChild(testContainer);
    setCalculatedFontSize(currentSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasoning, w, h, cfg.maxFontSize, cfg.minFontSize, cfg.fontScaleStep, cfg.lineHeight, cfg.shapeMargin, cfg.offsetTop, cfg.offsetBottom, cfg.offsetSides, cfg.shapeFloatWidth, cfg.shapeFloatMinHeight, cfg.leftShapePolygon, cfg.rightShapePolygon, cfg.textAlign, cfg.viewBoxWidth, cfg.viewBoxHeight, cfg.comicSafeZone]);

  // ── Notifica al avatar la posición del CENTRO de la nube ──
  useLayoutEffect(() => {
    const cx = placement.x + w / 2;
    const cy = placement.y + h / 2;
    window.dispatchEvent(
      new CustomEvent("kali:thought-cloud-move", { detail: { x: cx, y: cy } })
    );
  });

  if (!reasoning && !isStreaming) return null;

  const handleClick = () => {
    if (wasDrag) return;
    if (onExpand) onExpand();
  };

  const scrollStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    overflowY: "hidden",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    pointerEvents: "auto",
  };

  const innerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
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
  };

  const cursorColor = cfg.cursorColor ?? "var(--accent)";

  return (
    <motion.div
      className={`thought-cloud ${isStreaming ? "thought-cloud-streaming" : ""} ${
        dragging ? "thought-cloud-dragging" : ""
      } ${dimmed ? "thought-cloud-dimmed" : ""} ${className}`}
      style={{ x: placement.mx, y: placement.my, width: w, height: h }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: dimmed ? 0.55 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.3, opacity: { duration: 0.4 } }}
      onPointerDown={onPointerDown}
      onClick={handleClick}
    >
      <div
        className={`thought-cloud-breathing-wrap ${
          isStreaming === true && cfg.breathingEnabled ? "thought-cloud-breathing" : ""
        }`}
      >
        <ThoughtCloudSVG pointingAngle={placement.pointingAngle} isStreaming={isStreaming} config={cfg} tailPhase={tailPhase} onDismiss={onDismiss}>
          <div ref={scrollRef} className="thought-cloud-scroll" style={scrollStyle}>
            <div className="thought-cloud-inner" style={innerStyle}>
              <div className="thought-cloud-shape-left" style={shapeLeftStyle} />
              <div className="thought-cloud-shape-right" style={shapeRightStyle} />

              <div className="thought-cloud-text-wrap" style={textWrapStyle}>
                <div className="thought-cloud-text-body">
                  {isStreaming ? (
                    <span>
                      {displayText}
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
                    <span>{displayText}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ThoughtCloudSVG>
      </div>
    </motion.div>
  );
}