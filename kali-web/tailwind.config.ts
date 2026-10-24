import type { Config } from "tailwindcss";

const themeColor = (name: string) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

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
        // Theme colours resolve through color-mix so opacity modifiers (`bg-accent/10`,
        // `text-muted/60`) work with CSS-variable colours; plain `var()` colours silently drop them.
        surface: themeColor("--bg"),
        elevated: themeColor("--bg-elev"),
        foreground: themeColor("--fg"),
        fg: themeColor("--fg"),
        muted: themeColor("--muted"),
        accent: themeColor("--accent"),
        "accent-dim": themeColor("--accent-dim"),
        "on-accent": themeColor("--on-accent"),
        accent2: themeColor("--accent2"),
        accent3: "#c084fc",
        ok: themeColor("--ok"),
        err: themeColor("--err"),
        warn: themeColor("--warn"),
        "user-bubble": themeColor("--user-bubble"),
        "assistant-bubble": themeColor("--assistant-bubble"),
        border: themeColor("--border"),
        "ai-bg": themeColor("--ai-bg"),
        "ai-panel": themeColor("--ai-panel"),
        "ai-rail": themeColor("--ai-rail"),
        "ai-signal": themeColor("--ai-signal"),
        "ai-live": themeColor("--ai-live"),
        "ai-fail": themeColor("--ai-fail"),
        "ai-readout": themeColor("--ai-readout"),
        "ai-label": themeColor("--ai-label"),
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
        prose: ["var(--font-prose)"],
        ui: ["var(--font-ui)"],
        mono: ["var(--font-mono)"],
        game: ["var(--font-game)"],
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
