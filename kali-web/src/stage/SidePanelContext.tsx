import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface SidePanelContent {
  icon: ReactNode;
  title: string;
  onClear?: () => void;
  content?: ReactNode;
  badge?: number;
}

interface SidePanelContextValue {
  setSidePanelContent: (content: SidePanelContent | null) => void;
  clearSidePanel: () => void;
  sidePanelContent: SidePanelContent | null;
  setLeftSidePanelContent: (content: SidePanelContent | null) => void;
  clearLeftSidePanel: () => void;
  leftSidePanelContent: SidePanelContent | null;
}

export const SidePanelContext = createContext<SidePanelContextValue | null>(null);

export function useSidePanel(): SidePanelContextValue {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    throw new Error("useSidePanel must be used within a SidePanelContext provider");
  }
  return ctx;
}

interface SidePanelProviderProps {
  children: ReactNode;
  value?: SidePanelContextValue;
}

export function SidePanelProvider({ children, value }: SidePanelProviderProps) {
  const [internalContent, setInternalContent] = useState<SidePanelContent | null>(null);
  const [internalLeftContent, setInternalLeftContent] = useState<SidePanelContent | null>(null);

  const setSidePanelContent = useCallback((content: SidePanelContent | null) => {
    setInternalContent(content);
  }, []);

  const clearSidePanel = useCallback(() => {
    setInternalContent(null);
  }, []);

  const setLeftSidePanelContent = useCallback((content: SidePanelContent | null) => {
    setInternalLeftContent(content);
  }, []);

  const clearLeftSidePanel = useCallback(() => {
    setInternalLeftContent(null);
  }, []);

  const contextValue: SidePanelContextValue = value ?? {
    setSidePanelContent,
    clearSidePanel,
    sidePanelContent: internalContent,
    setLeftSidePanelContent,
    clearLeftSidePanel,
    leftSidePanelContent: internalLeftContent,
  };

  return (
    <SidePanelContext.Provider value={contextValue}>
      {children}
    </SidePanelContext.Provider>
  );
}
