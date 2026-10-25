// Kali-web entrypoint. Bootstraps React, i18n, and mounts the app.
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import "./lib/i18n";
import "./styles.css";
import { initializeDesktop } from "./lib/desktop";
import { DesktopSetup } from "./desktop/DesktopSetup";
import { DesktopAvatar } from "./desktop/DesktopAvatar";
import { DesktopArtifact } from "./desktop/DesktopArtifact";

void initializeDesktop().then((desktopConfig) => {
window.kaliDesktop?.onNavigate((hash) => { window.location.hash = `#${hash}`; });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {desktopConfig && !desktopConfig.backendUrl ? <DesktopSetup initial={desktopConfig} /> : <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/session/:sid" element={<App />} />
        <Route path="/desktop/avatar" element={<DesktopAvatar />} />
        <Route path="/desktop/artifact/:sid/:aid" element={<DesktopArtifact />} />
      </Routes>
    </HashRouter>}
  </React.StrictMode>
);
});
