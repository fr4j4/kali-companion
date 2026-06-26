/**
 * ThoughtCloudConfig — Configuración completa de la nube de pensamiento.
 *
 * Todos los parámetros visuales y de comportamiento son ajustables.
 * Pasar un `Partial<ThoughtCloudConfig>` al componente para overridear defaults.
 */

export type DistributionMode = "comic" | "scroll";

export interface ForeignObjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeZone {
  width: number;
  height: number;
}

export interface ThoughtCloudConfig {
  // ── Modos de distribución por estado ──
  collapsedMode: DistributionMode; // cómo mostrar colapsado
  expandedMode: DistributionMode; // cómo mostrar expandido

  // ── Fuente ──
  maxFontSize: number; // límite superior de auto-escala (px)
  minFontSize: number; // límite inferior — mínimo legible (px)
  fontScaleStep: number; // decremento al medir (px)
  lineHeight: number; // interlineado (multiplier)
  fontWeight: number; // peso de fuente
  textAlign: "center" | "left" | "right";

  // ── Shape-outside (texto fluye alrededor de curvas) ──
  shapeMargin: number; // margen del shape-outside (px)
  leftShapePolygon: string; // polígono flotante izquierdo
  rightShapePolygon: string; // polígono flotante derecho
  shapeFloatWidth: number; // ancho de los floats (% del contenedor)
  shapeFloatMinHeight: number; // min-height de los floats (px)

  // ── Padding interno (cojinetes) ──
  offsetTop: number; // padding superior (px)
  offsetBottom: number; // padding inferior (px)
  offsetSides: number; // padding lateral del texto (px)

  // ── clipPath de seguridad ──
  clipScale: number; // escala del clipPath (0.94 = 6% inset)
  clipCenterX: number; // centro X para el scale transform
  clipCenterY: number; // centro Y para el scale transform

  // ── foreignObject por modo (en unidades SVG viewBox 200x150) ──
  comicForeign: ForeignObjectRect;
  scrollForeign: ForeignObjectRect;

  // ── Zona segura para medición de auto-escala (px en el espacio del foreignObject) ──
  comicSafeZone: SafeZone;
  scrollSafeZone: SafeZone;

  // ── Máscara de desvanecimiento (sólo modo scroll) ──
  maskGradientStart: number; // % donde empieza el negro (15)
  maskGradientEnd: number; // % donde termina el negro (85)

  // ── Animación breathing ──
  breathingEnabled: boolean;
  breathingDuration: number; // segundos (2.2)
  breathingTranslateY: number; // px (-4)
  breathingScale: number; // multiplier (1.02)

  // ── SVG path de la nube ──
  cloudPath: string; // path d del cuerpo
  tailEdgeRadiusX: number; // radio horizontal del borde para anclar la cola
  tailEdgeRadiusY: number; // radio vertical del borde para anclar la cola
  tailOffsets: number[]; // distancias desde el borde a cada círculo
  tailRadii: number[]; // radios de cada círculo de la cola
  viewBoxWidth: number; // ancho del viewBox (200)
  viewBoxHeight: number; // alto del viewBox (150)

  // ── Stroke ──
  strokeWidth: number; // ancho del borde
  strokeDasharray: string; // "5 4" para punteado, "none" para sólido
  strokeLinecap: "round" | "butt" | "square";
  strokeLinejoin: "round" | "miter" | "bevel";

  // ── Colores (opcional, override del tema; si undefined usa var(--cloud-*)) ──
  cloudFill?: string; // fill de la nube
  cloudBorder?: string; // stroke de la nube
  cloudText?: string; // color del texto
  shadowColor?: string; // drop-shadow del SVG

  // ── Cursor de streaming ──
  cursorWidth: number; // px
  cursorHeight: number; // em
  cursorColor?: string; // si undefined usa var(--accent)

  // ── Dimensiones del wrapper ──
  collapsedWidth: number; // px
  collapsedHeight: number; // px
  expandedWidth: number; // px
  expandedHeight: number; // px

  // ── Órbita de la nube alrededor del avatar ──
  avatarRingRadius: number;     // radio del anillo blanco exterior (escala base)
  cloudCenterToTail: number;    // distancia del centro del wrapper al último círculo de cola (escala base)
  tailGap: number;               // gap mínimo entre el anillo y el último círculo (escala base)
  maxOrbitGap: number;           // gap máximo — rango de arrastre (escala base)

  // ── Texto truncado en colapsado ──
  collapsedCharLimit: number; // máx chars en colapsado antes de truncar (300)
}

export const defaultThoughtCloudConfig: ThoughtCloudConfig = {
  collapsedMode: "comic",
  expandedMode: "scroll",

  maxFontSize: 12,
  minFontSize: 6.5,
  fontScaleStep: 0.5,
  lineHeight: 1.3,
  fontWeight: 600,
  textAlign: "center",

  shapeMargin: 6,
  leftShapePolygon: "polygon(0% 0%, 100% 0%, 65% 20%, 35% 50%, 65% 80%, 100% 100%, 0% 100%)",
  rightShapePolygon: "polygon(100% 0%, 0% 0%, 35% 20%, 65% 50%, 35% 80%, 0% 100%, 100% 100%)",
  shapeFloatWidth: 28,
  shapeFloatMinHeight: 40,

  offsetTop: 18,
  offsetBottom: 20,
  offsetSides: 8,

  clipScale: 0.90,
  clipCenterX: 97.5,
  clipCenterY: 65,

  comicForeign: { x: 25, y: 12, width: 145, height: 106 },
  scrollForeign: { x: 28, y: 24, width: 144, height: 72 },

  comicSafeZone: { width: 170, height: 120 },
  scrollSafeZone: { width: 170, height: 88 },

  maskGradientStart: 15,
  maskGradientEnd: 85,

  breathingEnabled: true,
  breathingDuration: 2.2,
  breathingTranslateY: -4,
  breathingScale: 1.02,

  cloudPath:
    "M 50,95 C 35,95 25,80 25,65 C 25,48 40,35 55,35 C 58,22 75,12 95,12 C 115,12 132,22 135,35 C 152,32 170,45 170,62 C 170,78 160,95 145,95 C 145,108 128,118 110,118 C 92,118 80,108 75,108 C 68,108 58,105 50,95 Z",
  tailEdgeRadiusX: 73,
  tailEdgeRadiusY: 53,
  tailOffsets: [10, 22, 32],
  tailRadii: [7, 4.5, 3],
  viewBoxWidth: 200,
  viewBoxHeight: 150,

  strokeWidth: 3.5,
  strokeDasharray: "5 4",
  strokeLinecap: "round",
  strokeLinejoin: "round",

  cursorWidth: 1.5,
  cursorHeight: 3,

  collapsedWidth: 340,
  collapsedHeight: 260,
  expandedWidth: 520,
  expandedHeight: 400,

  avatarRingRadius: 90,
  cloudCenterToTail: 110,
  tailGap: 10,
  maxOrbitGap: 50,

  collapsedCharLimit: 120,
};

/** Mergea un Partial config con los defaults. */
export function mergeThoughtCloudConfig(
  override?: Partial<ThoughtCloudConfig>
): ThoughtCloudConfig {
  return { ...defaultThoughtCloudConfig, ...override };
}