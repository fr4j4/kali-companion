import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, session, Tray } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, X509Certificate } from "node:crypto";
import { homedir } from "node:os";
import { AVATAR_SIZES, defaultConfig, loadSharedConfig, nativeAgentRunning, saveSharedConfig, type SharedConfig } from "./config.js";
import { boundsFileName, loadBounds, saveBounds } from "./windowState.js";
import { sidecarPort, superviseSidecar, waitForPort } from "./sidecar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ORIGIN = "kali://app";
protocol.registerSchemesAsPrivileged([{ scheme: "kali", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// Connection + avatar preferences live in the shared config file (see config.ts) so the
// native avatar agent and this Electron shell agree on one source of truth.
let config: SharedConfig = defaultConfig();
let mainWindow: BrowserWindow | null = null;
let avatarWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let keepAlive = false;
let sidecar: ReturnType<typeof superviseSidecar> | null = null;
const execFileAsync = promisify(execFile);
const artifactWindows = new Map<string, BrowserWindow>();
/** Artifacts whose native window asked to go back to the canvas and whose main window has not been told yet. */
const pendingReturns = new Map<string, { sessionId: string; id: string }>();

interface RendererConfig {
  backendUrl: string;
  token: string;
  capabilityToken: string;
  showAvatar: boolean;
  avatarSize: number;
  mode: "local" | "remote";
  artifactsNative: boolean;
  captureThumbnail: boolean;
  captureSound: boolean;
  /** True when kali-avatar is running and owns the avatar, tray and native actions. */
  nativeAgent: boolean;
}

function rendererConfig(): RendererConfig {
  return {
    backendUrl: config.backendUrl, token: config.token, capabilityToken: config.capabilityToken,
    showAvatar: config.avatar.visible, avatarSize: config.avatar.size, mode: config.mode, artifactsNative: config.artifactsNative, captureThumbnail: config.avatar.captureThumbnail, captureSound: config.avatar.captureSound, nativeAgent: nativeAgentRunning(),
  };
}

function legacyConfigPath(): string { return join(app.getPath("userData"), "desktop.json"); }

/** One-time import of the pre-shared-config desktop.json (tokens encrypted with safeStorage). */
function migrateLegacyConfig(): SharedConfig | null {
  try {
    const saved = JSON.parse(readFileSync(legacyConfigPath(), "utf8")) as Record<string, unknown>;
    const next = defaultConfig();
    next.backendUrl = typeof saved.backendUrl === "string" ? saved.backendUrl : "";
    next.avatar.visible = saved.showAvatar !== false;
    next.avatar.size = AVATAR_SIZES.includes(saved.avatarSize as number) ? (saved.avatarSize as number) : 220;
    const canDecrypt = safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== "basic_text";
    if (canDecrypt && typeof saved.encryptedToken === "string" && saved.encryptedToken)
      next.token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, "base64"));
    if (canDecrypt && typeof saved.encryptedCapabilityToken === "string" && saved.encryptedCapabilityToken)
      next.capabilityToken = safeStorage.decryptString(Buffer.from(saved.encryptedCapabilityToken, "base64"));
    return next;
  } catch { return null; }
}

function loadConfig(): void {
  const shared = loadSharedConfig();
  if (shared) { config = shared; return; }
  const migrated = migrateLegacyConfig();
  if (migrated) { config = migrated; saveConfig(); }
}

function saveConfig(): void { saveSharedConfig(config); }

/** Local mode: point at a loopback kali-core and make sure both tokens exist. */
function prepareLocalMode(): void {
  config.backendUrl = `http://127.0.0.1:${sidecarPort()}`;
  if (!config.token) config.token = randomBytes(32).toString("hex");
  if (!config.capabilityToken) config.capabilityToken = randomBytes(32).toString("hex");
  saveConfig();
}

async function startLocalCore(): Promise<void> {
  if (config.mode !== "local" || sidecar) return;
  const port = sidecarPort();
  if (await waitForPort(port, 300)) {
    console.log(`[kali-shell] kali-core already listening on ${port}; not spawning a sidecar`);
    return;
  }
  sidecar = superviseSidecar(port, {
    KALI_HOST: "127.0.0.1", KALI_API_TOKEN: config.token, KALI_DESKTOP_TOKEN: config.capabilityToken,
  });
}

function webRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, "web") : resolve(__dirname, "../../kali-web/dist");
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const API_PREFIXES = ["/api", "/health", "/voices", "/profiles", "/llm", "/tts", "/stt", "/models", "/gsi", "/sessions", "/images", "/snapshots", "/file"];

async function handleAppRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== "app") return new Response("Forbidden", { status: 403 });
  if (API_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    if (!config.backendUrl) return new Response("Backend not configured", { status: 503 });
    const target = new URL(url.pathname + url.search, config.backendUrl);
    const headers = new Headers();
    for (const name of ["accept", "content-type", "range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (config.token) headers.set("Authorization", `Bearer ${config.token}`);
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = new Uint8Array(await request.arrayBuffer());
    try { return await net.fetch(target.toString(), init); }
    catch { return new Response("Backend unavailable", { status: 502 }); }
  }
  const root = webRoot();
  const requested = resolve(root, `.${url.pathname}`);
  const path = requested.startsWith(root + "/") && existsSync(requested) ? requested : join(root, "index.html");
  try { return new Response(readFileSync(path), { headers: { "Content-Type": MIME[extname(path)] || "application/octet-stream" } }); }
  catch { return new Response("Frontend build missing", { status: 404 }); }
}

// Self-signed backends: trust only a certificate pinned in kali-ca.pem (KALI_CA_FILE overrides),
// and only for the configured backend host. Everything else keeps Chromium's normal verification.
function installPinnedCertVerifier(): void {
  const caFile = process.env.KALI_CA_FILE || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "kali", "kali-ca.pem");
  session.defaultSession.setCertificateVerifyProc((req, callback) => {
    try {
      if (!config.backendUrl || !existsSync(caFile) || req.hostname !== new URL(config.backendUrl).hostname) return callback(-3);
      const pinned = new X509Certificate(readFileSync(caFile));
      return callback(pinned.fingerprint256 === new X509Certificate(req.certificate.data).fingerprint256 ? 0 : -3);
    } catch { return callback(-3); }
  });
}

function openMain(hash = "/", show = true): void {
  if (!mainWindow) {
    mainWindow = new BrowserWindow({ title: "Kali", width: 1280, height: 800, minWidth: 800, minHeight: 600, show,
      webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
    mainWindow.on("close", (event) => {
      if (quitting) return;
      // Closing the main window closes the artifacts' own windows too; each one goes back to its tab
      // the next time the canvas loads. Minimizing or hiding it leaves them alone.
      closeArtifactWindows();
      // With the native agent keeping the avatar and tray, this process only lives while a
      // window is open (lightweight); voice features can ask to stay resident via keepAlive.
      if (nativeAgentRunning() && !keepAlive && artifactWindows.size === 0) { quitting = true; return; }
      event.preventDefault(); mainWindow?.hide();
    });
    mainWindow.on("closed", () => { mainWindow = null; if (quitting) app.quit(); });
    mainWindow.loadURL(`${APP_ORIGIN}/#${hash}`);
  } else if (show) {
    mainWindow.show(); mainWindow.focus();
    mainWindow.webContents.send("navigate", hash);
  }
}

/** Handle `--open=<target>` / `--avatar=<show|hide|toggle>` from the command line or a second instance. */
function handleArgs(argv: string[]): boolean {
  let handled = false;
  for (const arg of argv) {
    const open = /^--open=(.+)$/.exec(arg)?.[1];
    if (open) {
      handled = true;
      const art = /^artifact:([\w-]{1,128}):([\w-]{1,128})$/.exec(open);
      if (art) { try { openArtifact(art[1], art[2]); } catch (error) { console.warn(error); } }
      else openMain(open === "artifacts" ? "/?panel=artifacts" : open === "settings" ? "/?panel=settings" : "/");
    }
    const avatar = /^--avatar=(show|hide|toggle)$/.exec(arg)?.[1];
    if (avatar) {
      handled = true;
      setAvatarVisible(avatar === "toggle" ? !config.avatar.visible : avatar === "show");
    }
  }
  return handled;
}

function setAvatarVisible(visible: boolean): void {
  config.avatar.visible = visible;
  saveConfig();
  // The native agent (watching the shared config) owns the avatar when it is running.
  if (nativeAgentRunning()) { avatarWindow?.hide(); updateTray(); return; }
  if (!visible) { avatarWindow?.hide(); updateTray(); return; }
  if (!avatarWindow) {
    avatarWindow = new BrowserWindow({ title: "Kali Avatar", width: config.avatar.size, height: config.avatar.size + 20, minWidth: 150, minHeight: 150,
      transparent: true, frame: false, resizable: true, skipTaskbar: true, alwaysOnTop: !process.env.WAYLAND_DISPLAY,
      webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    avatarWindow.on("close", (event) => { if (!quitting) { event.preventDefault(); setAvatarVisible(false); } });
    avatarWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    avatarWindow.loadURL(`${APP_ORIGIN}/#/desktop/avatar`);
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      avatarWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
          void execFileAsync("hyprctl", ["dispatch", "setfloating", "title:^(Kali Avatar)$"], { timeout: 5000 })
            .then(() => execFileAsync("hyprctl", ["dispatch", "pin", "title:^(Kali Avatar)$"], { timeout: 5000 }))
            .catch((error: unknown) => console.warn("Hyprland avatar floating rule unavailable:", error));
        }, 400);
      });
    }
  }
  avatarWindow.show(); updateTray();
}

/** Tell the main window whether an artifact lives in a native window; false when nobody could receive it. */
function notifyArtifactNative(sessionId: string, id: string, open: boolean, returned: boolean): boolean {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!wc || wc.isLoading()) return false;
  wc.send("desktop:artifact-native", { sessionId, id, open, returned });
  return true;
}

/** Close every artifact window, marking each to go back to its tab. */
function closeArtifactWindows(): void {
  for (const [key, win] of artifactWindows) {
    if (win.isDestroyed()) continue;
    const [sessionId, id] = key.split(":");
    pendingReturns.set(key, { sessionId, id });
    win.close();
  }
}

function openArtifact(sessionId: string, artifactId: string, type?: string): void {
  if (!/^[\w-]{1,128}$/.test(sessionId) || !/^[\w-]{1,128}$/.test(artifactId)) throw new Error("Invalid artifact reference");
  const key = `${sessionId}:${artifactId}`;
  const existing = artifactWindows.get(key);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  // Size and monitor are remembered per kind of artifact; a kind seen for the first time starts from the shared file.
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  const boundsFile = join(app.getPath("userData"), boundsFileName(type));
  const bounds = loadBounds(existsSync(boundsFile) ? boundsFile : join(app.getPath("userData"), boundsFileName()), displays);
  const win = new BrowserWindow({ title: `kali-artifact · ${artifactId}`, ...bounds, minWidth: 400, minHeight: 300,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  artifactWindows.set(key, win);
  // Remember the last size/position the user left an artifact window at (position is ignored under Wayland).
  win.on("close", () => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) saveBounds(boundsFile, win.getBounds());
    // Closed with its ✕ (or Esc): it goes back to its tab, never silently away.
    if (!quitting) pendingReturns.set(key, { sessionId, id: artifactId });
  });
  win.on("closed", updateTray);
  updateTray();
  notifyArtifactNative(sessionId, artifactId, true, false);
  win.on("closed", () => {
    artifactWindows.delete(key);
    const returned = pendingReturns.has(key);
    // Keep the pending return until a live main window has received it (it may not exist yet).
    if (notifyArtifactNative(sessionId, artifactId, false, returned) && returned) pendingReturns.delete(key);
    if (nativeAgentRunning() && !keepAlive && artifactWindows.size === 0 && (!mainWindow || !mainWindow.isVisible())) { quitting = true; app.quit(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadURL(`${APP_ORIGIN}/#/desktop/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`);
}

/** Feedback for a capture that already happened: thumbnail and shutter in the fallback avatar. Informational only. */
function announceCapture(png: Buffer): void {
  const { captureThumbnail, captureSound } = config.avatar;
  if (!avatarWindow || avatarWindow.isDestroyed() || !avatarWindow.isVisible() || (!captureThumbnail && !captureSound)) return;
  let thumb: string | null = null;
  if (captureThumbnail) {
    const image = nativeImage.createFromBuffer(png);
    if (!image.isEmpty()) thumb = image.resize({ width: 200, quality: "good" }).toDataURL();
  }
  avatarWindow.webContents.send("desktop:capture", { thumb, sound: captureSound });
}

async function runDesktopAction(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (action === "launch_app") {
    const name = params.name;
    if (typeof name !== "string" || !/^[\w.-]{1,100}$/.test(name)) throw new Error("Invalid desktop entry");
    await execFileAsync("gtk-launch", [name], { timeout: 10000 });
    return { name, message: `Launched ${name}` };
  }
  if (action === "list_monitors") {
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      const { stdout } = await execFileAsync("hyprctl", ["monitors", "-j"], { timeout: 5000 });
      const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
      return { monitors: raw.map((m, i) => ({ id: i + 1, name: m.name, description: m.description || m.name,
        width: m.width, height: m.height, x: m.x, y: m.y, primary: m.focused, active: true, focused: m.focused,
        refresh_rate: m.refreshRate || 0, transform: m.transform || 0 })) };
    }
    return { monitors: screen.getAllDisplays().map((d, i) => ({ id: i + 1, name: String(d.id), description: d.label || `Monitor ${i + 1}`,
      width: d.bounds.width, height: d.bounds.height, x: d.bounds.x, y: d.bounds.y, primary: d.id === screen.getPrimaryDisplay().id,
      active: true, focused: d.id === screen.getPrimaryDisplay().id, refresh_rate: d.displayFrequency || 0, transform: 0 })) };
  }
  if (action === "screenshot") {
    const output = params.output;
    if (output != null && typeof output !== "string") throw new Error("Invalid output");
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      const { monitors } = await runDesktopAction("list_monitors", {});
      const available = monitors as Array<{ name: string; primary: boolean }>;
      const selected = output && output !== "primary" && output !== "secondary" ? output
        : output === "secondary" ? available.find((m) => !m.primary)?.name : available.find((m) => m.primary)?.name;
      if (selected && !available.some((m) => m.name === selected)) throw new Error("Unknown monitor");
      const { stdout } = await execFileAsync("grim", selected ? ["-o", selected, "-"] : ["-"], { encoding: "buffer", maxBuffer: 25 * 1024 * 1024, timeout: 15000 });
      announceCapture(stdout as Buffer);
      return { png_base64: (stdout as Buffer).toString("base64") };
    }
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 3840, height: 2160 } });
    const source = output && output !== "primary" ? sources.find((s) => s.display_id === output || s.name === output) : sources[0];
    if (!source) throw new Error("Monitor unavailable");
    const png = source.thumbnail.toPNG();
    announceCapture(png);
    return { png_base64: png.toString("base64") };
  }
  throw new Error("Unsupported desktop action");
}

const TRAY_TEXT = {
  es: { show: "Mostrar Kali", chat: "Abrir chat", artifacts: "Artefactos", hide: "Ocultar avatar", showAvatar: "Mostrar avatar", settings: "Configuración", quit: "Salir", online: "Conectado", offline: "Sin conexión", open: "ventanas de artefacto abiertas" },
  en: { show: "Show Kali", chat: "Open chat", artifacts: "Artifacts", hide: "Hide avatar", showAvatar: "Show avatar", settings: "Settings", quit: "Quit", online: "Connected", offline: "Offline", open: "artifact windows open" },
};
let backendConnected = false;

function updateTray(): void {
  if (!tray) return;
  const text = app.getLocale().toLowerCase().startsWith("es") ? TRAY_TEXT.es : TRAY_TEXT.en;
  const open = [...artifactWindows.values()].filter((w) => !w.isDestroyed()).length;
  tray.setToolTip(`Kali Companion · ${backendConnected ? text.online : text.offline}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: backendConnected ? `● ${text.online}` : `○ ${text.offline}`, enabled: false },
    ...(open > 0 ? [{ label: `${open} ${text.open}`, enabled: false } as const] : []),
    { type: "separator" },
    { label: text.show, click: () => openMain() },
    { label: text.chat, click: () => openMain("/") },
    { label: text.artifacts, click: () => openMain("/?panel=artifacts") },
    { label: config.avatar.visible ? text.hide : text.showAvatar, click: () => setAvatarVisible(!config.avatar.visible) },
    { label: text.settings, click: () => openMain("/?panel=settings") },
    { type: "separator" },
    { label: text.quit, click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray(): void {
  if (nativeAgentRunning()) return;
  const iconPath = join(__dirname, "../tray.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Kali Companion");
  tray.on("click", () => openMain());
  updateTray();
}

// Stable WM_CLASS / Wayland app_id so compositor rules (KWin, Hyprland, ...) can match Kali windows.
// Electron cannot set it per window, so artifact windows are told apart by their "kali-artifact · " title.
app.setName("kali-shell");
app.commandLine.appendSwitch("class", "kali-shell");
if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", (_event, argv) => { if (!handleArgs(argv)) openMain(); });

app.whenReady().then(() => {
  loadConfig();
  if (config.mode === "local") { prepareLocalMode(); void startLocalCore(); }
  protocol.handle("kali", handleAppRequest);
  installPinnedCertVerifier();
  ipcMain.handle("desktop:get-config", () => rendererConfig());
  ipcMain.handle("desktop:save-config", (_event, next: { mode?: "local" | "remote"; backendUrl: string; token: string; capabilityToken: string }) => {
    if (next.mode === "local") {
      config.mode = "local";
      prepareLocalMode();
      saveConfig();
      void startLocalCore();
      return true;
    }
    const url = new URL(next.backendUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Use HTTPS for remote backends");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use the backend origin without path or URL credentials");
    if (url.protocol === "https:" && !next.token?.trim()) throw new Error("An API token is required for remote backends");
    config.mode = "remote";
    config.backendUrl = url.toString().replace(/\/$/, "");
    config.token = next.token.trim();
    config.capabilityToken = next.capabilityToken?.trim() || "";
    sidecar?.stop(); sidecar = null;
    saveConfig();
    return true;
  });
  ipcMain.handle("desktop:keep-alive", (_event, value: boolean) => { keepAlive = value === true; });
  // Consent as a system dialog, so it shows even when the canvas window is closed or hidden.
  // Anything but an explicit button press (Escape, closing, the timeout) is a denial.
  ipcMain.handle("desktop:consent", async (_event, text: { title?: unknown; detail?: unknown; allow?: unknown; allowSession?: unknown; deny?: unknown }) => {
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const buttons = [str(text.deny, 40) || "Deny", str(text.allow, 40) || "Allow once", str(text.allowSession, 60) || "Allow for this chat"];
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const result = await dialog.showMessageBox({
        type: "question", title: "Kali", message: str(text.title, 200), detail: str(text.detail, 800),
        buttons, defaultId: 0, cancelId: 0, noLink: true, signal: abort.signal,
      });
      return result.response === 1 ? "allow" : result.response === 2 ? "allow_session" : "deny";
    } catch {
      return "deny";
    } finally {
      clearTimeout(timer);
    }
  });
  ipcMain.handle("desktop:open-main", (_event, hash?: string) => openMain(hash));
  ipcMain.handle("desktop:show-avatar", (_event, visible: boolean) => setAvatarVisible(visible));
  ipcMain.handle("desktop:set-avatar-size", (_event, size: number) => {
    if (!AVATAR_SIZES.includes(size)) throw new Error("Invalid avatar size");
    config.avatar.size = size;
    avatarWindow?.setSize(size, size + 20);
    saveConfig();
  });
  ipcMain.handle("desktop:set-avatar-corner", (_event, corner: string) => {
    if (!["top-left", "top-right", "bottom-left", "bottom-right"].includes(corner)) throw new Error("Invalid corner");
    config.avatar.corner = corner as SharedConfig["avatar"]["corner"];
    delete config.avatar.x;
    delete config.avatar.y;
    saveConfig();
  });
  ipcMain.handle("desktop:set-capture-feedback", (_event, options: { thumbnail?: unknown; sound?: unknown }) => {
    config.avatar.captureThumbnail = options?.thumbnail === true;
    config.avatar.captureSound = options?.sound === true;
    saveConfig();
  });
  ipcMain.handle("desktop:set-artifacts-native", (_event, value: boolean) => { config.artifactsNative = value === true; saveConfig(); });
  ipcMain.handle("desktop:native-artifacts", () => {
    const open = [...artifactWindows.keys()].map((key) => { const [sessionId, id] = key.split(":"); return { sessionId, id }; });
    const returned = [...pendingReturns.values()];
    pendingReturns.clear();
    return { open, returned };
  });
  // The artifact window asks to go back to the canvas: remember it, show the main window, close this one.
  ipcMain.handle("desktop:return-artifact", (event, sid: string, id: string) => {
    const key = `${sid}:${id}`;
    const win = artifactWindows.get(key);
    if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error("Only the artifact window may return it");
    pendingReturns.set(key, { sessionId: sid, id });
    openMain("/");
    win.close();
  });
  ipcMain.handle("desktop:open-artifact", (_event, sid: string, id: string, type?: unknown) => openArtifact(sid, id, typeof type === "string" ? type : undefined));
  // "Bring back" from the main window's ghost tab.
  ipcMain.handle("desktop:bring-artifact", (event, sid: string, id: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Only the main window may bring an artifact back");
    const key = `${sid}:${id}`;
    const win = artifactWindows.get(key);
    if (!win || win.isDestroyed()) return;
    pendingReturns.set(key, { sessionId: sid, id });
    win.close();
  });
  ipcMain.handle("desktop:action", (event, action: string, params: Record<string, unknown>) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Only main window may execute desktop actions");
    return runDesktopAction(action, params);
  });
  ipcMain.on("desktop:presence", (_event, state: { connected: boolean } & Record<string, unknown>) => {
    avatarWindow?.webContents.send("desktop:presence", state);
    if (state.connected !== backendConnected) { backendConnected = state.connected; updateTray(); }
    tray?.setToolTip(state.connected ? "Kali Companion — conectado" : "Kali Companion — sin conexión");
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(permission === "media" && wc.getURL().startsWith(`${APP_ORIGIN}/`)));
  createTray();
  const argv = process.argv.slice(1);
  if (!handleArgs(argv)) openMain("/", !argv.includes("--background"));
  if (config.backendUrl && config.avatar.visible && !nativeAgentRunning()) setAvatarVisible(true);
  if (process.env.KALI_DESKTOP_SMOKE === "1") {
    mainWindow?.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void mainWindow?.webContents.executeJavaScript("document.getElementById('root')?.childElementCount || 0")
          .then((count: number) => { console.log(`desktop smoke root children: ${count}`); app.exit(count > 0 ? 0 : 1); })
          .catch(() => app.exit(1));
      }, 1000);
    });
    setTimeout(() => app.exit(2), 15000);
  }
});

app.on("before-quit", () => { quitting = true; sidecar?.stop(); });
