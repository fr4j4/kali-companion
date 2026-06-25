import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Vite config for kali-web.
//
// The frontend is served in two ways:
//   - In development (`vite` dev server): Tauri loads http://localhost:5173.
//   - In production build: Tauri loads the static files from ../kali-web/dist.
//
// The Vite proxy forwards /ws (WS) and /images (HTTP) to the core
// server at 127.0.0.1:8900.
//
// The `@` alias points at `src/` so imports stay short.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8900",
        ws: true,
      },
      "/images": {
        target: "http://127.0.0.1:8900",
      },
      "/snapshots": {
        target: "http://127.0.0.1:8900",
      },
      "/file": {
        target: "http://127.0.0.1:8900",
      },
      "/voices": {
        target: "http://127.0.0.1:8900",
      },
      "/profiles": {
        target: "http://127.0.0.1:8900",
      },
      "/llm": {
        target: "http://127.0.0.1:8900",
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8900",
        ws: true,
      },
      "/images": {
        target: "http://127.0.0.1:8900",
      },
      "/snapshots": {
        target: "http://127.0.0.1:8900",
      },
      "/file": {
        target: "http://127.0.0.1:8900",
      },
      "/voices": {
        target: "http://127.0.0.1:8900",
      },
      "/profiles": {
        target: "http://127.0.0.1:8900",
      },
      "/llm": {
        target: "http://127.0.0.1:8900",
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "i18n": ["i18next", "react-i18next", "i18next-browser-languagedetector"],
          "motion": ["framer-motion"],
          "markdown": ["marked", "marked-highlight"],
          "syntax": ["highlight.js", "shiki"],
          "mermaid": ["mermaid"],
        },
      },
    },
  },
});