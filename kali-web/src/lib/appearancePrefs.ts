// Per-viewer appearance preferences that only need a root attribute (no React state plumbing).
export type FontChoice = "default" | "system" | "mono";
export const FONT_CHOICES: FontChoice[] = ["default", "system", "mono"];
const KEY = "kali.font";

export function loadFont(): FontChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return FONT_CHOICES.includes(saved as FontChoice) ? (saved as FontChoice) : "default";
  } catch { return "default"; }
}

export function applyFont(choice: FontChoice): void {
  if (choice === "default") document.documentElement.removeAttribute("data-font");
  else document.documentElement.setAttribute("data-font", choice);
}

export function saveFont(choice: FontChoice): void {
  try { localStorage.setItem(KEY, choice); } catch { /* storage may be blocked */ }
  applyFont(choice);
}
