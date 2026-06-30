import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    fontSize: {
      xs: ["calc(0.75rem * var(--mul-text))", { lineHeight: "1rem" }],
      sm: ["calc(0.875rem * var(--mul-text))", { lineHeight: "1.25rem" }],
      base: ["calc(1rem * var(--mul-text))", { lineHeight: "1.5rem" }],
      lg: ["calc(1.125rem * var(--mul-text))", { lineHeight: "1.75rem" }],
      xl: ["calc(1.25rem * var(--mul-text))", { lineHeight: "1.75rem" }],
      "2xl": ["calc(1.5rem * var(--mul-text))", { lineHeight: "2rem" }],
      "3xl": ["calc(1.875rem * var(--mul-text))", { lineHeight: "2.25rem" }],
      "4xl": ["calc(2.25rem * var(--mul-text))", { lineHeight: "2.5rem" }],
    },
    extend: {
      colors: {
        surface: "var(--bg)",
        elevated: "var(--bg-elev)",
        foreground: "var(--fg)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        accent2: "#06b6d4",
        accent3: "#c084fc",
        ok: "var(--ok)",
        err: "var(--err)",
        warn: "var(--warn)",
        "user-bubble": "var(--user-bubble)",
        "assistant-bubble": "var(--assistant-bubble)",
        border: "var(--border)",
        "ai-bg": "var(--ai-bg)",
        "ai-panel": "var(--ai-panel)",
        "ai-rail": "var(--ai-rail)",
        "ai-signal": "var(--ai-signal)",
        "ai-live": "var(--ai-live)",
        "ai-fail": "var(--ai-fail)",
        "ai-readout": "var(--ai-readout)",
        "ai-label": "var(--ai-label)",
      },
      screens: {
        xs: "480px",
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
      minWidth: {
        sidebar: "260px",
        "sidebar-wide": "400px",
        canvas: "420px",
      },
      maxWidth: {
        sidebar: "260px",
        "sidebar-wide": "400px",
        canvas: "420px",
      },
      borderRadius: {
        sheet: "1rem",
        bubble: "0.875rem",
      },
      spacing: {
        safe: "env(safe-area-inset-bottom)",
        "safe-t": "env(safe-area-inset-top)",
      },
      fontFamily: {
        prose: ['"Iowan Old Style"', "Georgia", "Cambria", "serif"],
        ui: ['"IBM Plex Sans"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      transitionTimingFunction: {
        stage: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
        blink: {
          "0%, 50%": { opacity: "1" },
          "51%, 100%": { opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
        fadeIn: "fadeIn 400ms ease-out",
        shimmer: "shimmer 1.5s infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
