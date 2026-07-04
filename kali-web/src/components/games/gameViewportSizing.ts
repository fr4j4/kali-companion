export const GAME_SCALE_DESKTOP_BASE = 1.12;
export const GAME_SCALE_DESKTOP_MAX = 1.48;
export const GAME_SCALE_MOBILE_BASE = 1.02;
export const GAME_SCALE_SAFE_PADDING = 16;

export interface GameScaleOptions {
  naturalWidth: number;
  naturalHeight: number;
  containerWidth: number;
  containerHeight: number;
  isMobile: boolean;
  safePadding?: number;
  desktopBase?: number;
  desktopMax?: number;
  mobileBase?: number;
}

export function computeGameScale({
  naturalWidth,
  naturalHeight,
  containerWidth,
  containerHeight,
  isMobile,
  safePadding = GAME_SCALE_SAFE_PADDING,
  desktopBase = GAME_SCALE_DESKTOP_BASE,
  desktopMax = GAME_SCALE_DESKTOP_MAX,
  mobileBase = GAME_SCALE_MOBILE_BASE,
}: GameScaleOptions): number {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return 0;
  }

  const availableWidth = Math.max(0, containerWidth - safePadding * 2);
  const availableHeight = Math.max(0, containerHeight - safePadding * 2);
  const fit = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);

  if (fit <= 0) return 0;

  if (isMobile) {
    return Math.min(fit, fit * mobileBase);
  }

  const boosted = fit * desktopBase;
  return Math.min(fit, Math.min(desktopMax, boosted));
}

export function computeGameOffsets(
  naturalWidth: number,
  naturalHeight: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  if (scale <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.max(0, (containerWidth - naturalWidth * scale) / 2),
    y: Math.max(0, (containerHeight - naturalHeight * scale) / 2),
  };
}
