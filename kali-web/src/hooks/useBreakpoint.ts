import { useMediaQuery } from "./useMediaQuery";

export function useBreakpoint() {
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isSmallMobile = useMediaQuery("(max-width: 639px)");
  const isTablet = useMediaQuery("(min-width: 640px) and (max-width: 1023px)");
  const hasCoarsePointer = useMediaQuery("(pointer: coarse)");
  const isPortrait = useMediaQuery("(orientation: portrait)");
  const isLandscape = useMediaQuery("(orientation: landscape)");

  return {
    isMobile,
    isDesktop,
    isSmallMobile,
    isTablet,
    hasCoarsePointer,
    isPortrait,
    isLandscape,
  } as const;
}
