import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
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
        canvas: "420px",
      },
      maxWidth: {
        sidebar: "260px",
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
        ui: ["Inter", "system-ui", "-apple-system", "sans-serif"],
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
