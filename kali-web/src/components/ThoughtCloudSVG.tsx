import { motion } from "framer-motion";
import type { ThoughtCloudConfig } from "./ThoughtCloudConfig";

type TailPhase = "idle" | "appearing" | "active";

interface ThoughtCloudSVGProps {
  pointingAngle: number;
  isStreaming?: boolean;
  config: ThoughtCloudConfig;
  tailPhase?: TailPhase;
  onDismiss?: () => void;
  children: React.ReactNode;
}

export function ThoughtCloudSVG({
  pointingAngle,
  isStreaming = false,
  config,
  tailPhase = "idle",
  onDismiss,
  children,
}: ThoughtCloudSVGProps) {
  const clipTransform = `translate(${config.clipCenterX}, ${config.clipCenterY}) scale(${config.clipScale}) translate(${-config.clipCenterX}, ${-config.clipCenterY})`;

  const fillVal = config.cloudFill ?? "var(--cloud-fill)";
  const strokeVal = config.cloudBorder ?? "var(--cloud-border)";
  const shadowVal = config.shadowColor ?? "rgba(0,0,0,0.3)";

  // ── Cola dinámica: posicionar círculos en el borde hacia el avatar ──
  const dirX = Math.cos(pointingAngle);
  const dirY = Math.sin(pointingAngle);
  const bordeX = config.clipCenterX + dirX * config.tailEdgeRadiusX;
  const bordeY = config.clipCenterY + dirY * config.tailEdgeRadiusY;
  const tailPositions = config.tailOffsets.map((offset, i) => ({
    x: bordeX + dirX * offset,
    y: bordeY + dirY * offset,
    r: config.tailRadii[i] ?? 3,
  }));

  const isAppearing = tailPhase === "appearing";

  return (
    <svg
      className="thought-cloud-svg"
      viewBox={`0 0 ${config.viewBoxWidth} ${config.viewBoxHeight}`}
      preserveAspectRatio="none"
      style={{ filter: `drop-shadow(0 15px 30px ${shadowVal})` }}
    >
      <defs>
        <clipPath id="cloud-inner-clip">
          <path d={config.cloudPath} transform={clipTransform} />
        </clipPath>
      </defs>

      {/* Cuerpo principal de la nube */}
      <motion.path
        className="thought-cloud-body-path"
        d={config.cloudPath}
        fill={fillVal}
        stroke={strokeVal}
        strokeWidth={config.strokeWidth}
        strokeLinecap={config.strokeLinecap}
        strokeLinejoin={config.strokeLinejoin}
        strokeDasharray={config.strokeDasharray === "none" ? undefined : config.strokeDasharray}
        initial={false}
        animate={isStreaming ? { scale: [1, 1.008, 1] } : { scale: 1 }}
        transition={
          isStreaming ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : {}
        }
        style={{ transformOrigin: "100px 75px" }}
      />

      {/* Colita — círculos posicionados dinámicamente en el borde hacia el avatar.
          Cuando tailPhase="appearing", aparecen uno a uno con stagger. */}
      <g className="thought-cloud-tail">
        {tailPositions.map((c, i) => (
          <motion.circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={c.r}
            fill={fillVal}
            stroke={strokeVal}
            strokeWidth={config.strokeWidth - 0.5}
            strokeLinecap={config.strokeLinecap}
            strokeLinejoin={config.strokeLinejoin}
            strokeDasharray={config.strokeDasharray === "none" ? undefined : config.strokeDasharray}
            initial={isAppearing ? { scale: 0, opacity: 0 } : false}
            animate={
              isAppearing
                ? { scale: 1, opacity: 1 }
                : { scale: 1, opacity: 1 }
            }
            transition={
              isAppearing
                ? { delay: i * 0.18, duration: 0.35, ease: "easeOut" }
                : { duration: 0 }
            }
          />
        ))}
      </g>

      {/* Contenido textual recortado por la silueta de la nube (inset 90%) */}
      <foreignObject
        x="0"
        y="0"
        width={config.viewBoxWidth}
        height={config.viewBoxHeight}
        clipPath="url(#cloud-inner-clip)"
        className="thought-cloud-foreign"
      >
        {children}
      </foreignObject>

      {/* Botón dismiss (X) — dentro del SVG pero fuera del clipPath, en el borde superior derecho de la nube */}
      {onDismiss && (
        <g
          className="thought-cloud-dismiss-svg"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          style={{ cursor: "pointer" }}
        >
          <rect
            x="148"
            y="18"
            width="22"
            height="22"
            rx="4"
            fill="rgba(0,0,0,0.12)"
          />
          <line
            x1="154"
            y1="24"
            x2="164"
            y2="34"
            stroke="var(--cloud-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <line
            x1="164"
            y1="24"
            x2="154"
            y2="34"
            stroke="var(--cloud-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}