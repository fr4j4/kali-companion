import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--bg)",
        elevated: "var(--bg-elev)",
        foreground: "var(--fg)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        ok: "var(--ok)",
        err: "var(--err)",
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
    },
  },
  plugins: [],
} satisfies Config;
