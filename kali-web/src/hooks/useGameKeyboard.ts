import { useEffect } from "react";

export function useGameKeyboard(
  focused: boolean,
  handler: (e: KeyboardEvent) => void,
) {
  useEffect(() => {
    if (!focused) return;
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused, handler]);
}
