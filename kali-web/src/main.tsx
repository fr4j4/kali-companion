// Kali-web entrypoint. Bootstraps React, i18n, and mounts the app.
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import "./lib/i18n";
import "./styles.css";

// HTMLTexture polyfill must be installed before any Canvas/renderer is created — en HMD el raster vivo de html depende de esto.
import { installHtmlInCanvasPolyfill } from "three-html-render/polyfill";
try { installHtmlInCanvasPolyfill(); } catch { /* ignore if already installed */ }

// VR entry is code-split: it drags three/r3f/xr ONLY when visited.
const VREntry = React.lazy(() => import("./vr/VREntry"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/session/:sid" element={<App />} />
        <Route
          path="/vr"
          element={
            <React.Suspense fallback={<div className="w-screen h-screen bg-[#0b0f14]" />}>
              <VREntry />
            </React.Suspense>
          }
        />
        <Route
          path="/vr/session/:sid"
          element={
            <React.Suspense fallback={<div className="w-screen h-screen bg-[#0b0f14]" />}>
              <VREntry />
            </React.Suspense>
          }
        />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);