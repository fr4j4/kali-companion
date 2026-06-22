import { useMediaQuery } from "./useMediaQuery";

export function useBreakpoint() {
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isSmallMobile = useMediaQuery("(max-width: 639px)");
  const isTablet = useMediaQuery("(min-width: 640px) and (max-width: 1023px)");

  return { isMobile, isDesktop, isSmallMobile, isTablet } as const;
}
