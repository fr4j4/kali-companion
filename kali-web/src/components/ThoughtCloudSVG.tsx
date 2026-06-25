import { motion } from "framer-motion";
import type { DistributionMode, ThoughtCloudConfig, ForeignObjectRect } from "./ThoughtCloudConfig";

interface ThoughtCloudSVGProps {
  pointingAngle: number;
  isStreaming?: boolean;
  mode: DistributionMode;
  config: ThoughtCloudConfig;
  children: React.ReactNode;
}

/**
 * Nube de pensamiento con enmascaramiento vectorial completo (v5.0).
 *
 * - Un único path SVG define la silueta orgánica de la nube.
 * - Ese path se usa como <clipPath> escalado al `clipScale` (94%) para crear
 *   un margen de seguridad entre el borde visible y el texto.
 * - Un <foreignObject> se posiciona en la zona segura según el modo activo
 *   (comic = más grande, scroll = confinado al centro) y se recorta con el clipPath.
 * - La colita (círculos) se posiciona dinámicamente en el borde de la nube
 *   en la dirección del avatar, para que siempre salga hacia él sin ser tapada.
 */
export function ThoughtCloudSVG({
  pointingAngle,
  isStreaming = false,
  mode,
  config,
  children,
}: ThoughtCloudSVGProps) {
  // foreignObject dinámico según modo.
  const fo: ForeignObjectRect =
    mode === "comic" ? config.comicForeign : config.scrollForeign;

  // Transform del clipPath: escala desde el centro de la nube.
  const clipTransform = `translate(${config.clipCenterX}, ${config.clipCenterY}) scale(${config.clipScale}) translate(${-config.clipCenterX}, ${-config.clipCenterY})`;

  const fillVal = config.cloudFill ?? "var(--cloud-fill)";
  const strokeVal = config.cloudBorder ?? "var(--cloud-border)";
  const shadowVal = config.shadowColor ?? "rgba(0,0,0,0.3)";

  // ── Cola dinámica: posicionar círculos en el borde hacia el avatar ──
  // Dirección unitaria hacia el avatar (pointingAngle apunta de la nube al avatar).
  const dirX = Math.cos(pointingAngle);
  const dirY = Math.sin(pointingAngle);
  // Borde de la nube en la dirección del avatar (elipse aproximada).
  const bordeX = config.clipCenterX + dirX * config.tailEdgeRadiusX;
  const bordeY = config.clipCenterY + dirY * config.tailEdgeRadiusY;
  // Círculos a lo largo de la dirección, partiendo desde el borde.
  const tailPositions = config.tailOffsets.map((offset, i) => ({
    x: bordeX + dirX * offset,
    y: bordeY + dirY * offset,
    r: config.tailRadii[i] ?? 3,
  }));

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

      {/* Colita — círculos posicionados dinámicamente en el borde hacia el avatar */}
      <g className="thought-cloud-tail">
        {tailPositions.map((c, i) => (
          <circle
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
          />
        ))}
      </g>

      {/* Contenido textual recortado por la silueta de la nube (inset 94%) */}
      <foreignObject
        x={fo.x}
        y={fo.y}
        width={fo.width}
        height={fo.height}
        clipPath="url(#cloud-inner-clip)"
        className="thought-cloud-foreign"
      >
        {children}
      </foreignObject>
    </svg>
  );
}