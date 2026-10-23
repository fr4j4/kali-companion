import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, session, Tray } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { AVATAR_SIZES, defaultConfig, loadSharedConfig, nativeAgentRunning, saveSharedConfig, type SharedConfig } from "./config.js";
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

interface RendererConfig {
  backendUrl: string;
  token: string;
  capabilityToken: string;
  showAvatar: boolean;
  avatarSize: number;
  mode: "local" | "remote";
  /** True when kali-avatar is running and owns the avatar, tray and native actions. */
  nativeAgent: boolean;
}

function rendererConfig(): RendererConfig {
  return {
    backendUrl: config.backendUrl, token: config.token, capabilityToken: config.capabilityToken,
    showAvatar: config.avatar.visible, avatarSize: config.avatar.size, mode: config.mode, nativeAgent: nativeAgentRunning(),
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

function openMain(hash = "/", show = true): void {
  if (!mainWindow) {
    mainWindow = new BrowserWindow({ title: "Kali", width: 1280, height: 800, minWidth: 800, minHeight: 600, show,
      webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
    mainWindow.on("close", (event) => {
      if (quitting) return;
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

function openArtifact(sessionId: string, artifactId: string): void {
  if (!/^[\w-]{1,128}$/.test(sessionId) || !/^[\w-]{1,128}$/.test(artifactId)) throw new Error("Invalid artifact reference");
  const key = `${sessionId}:${artifactId}`;
  const existing = artifactWindows.get(key);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  const win = new BrowserWindow({ title: `kali-artifact · ${artifactId}`, width: 850, height: 650, minWidth: 400, minHeight: 300,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  artifactWindows.set(key, win);
  win.on("closed", () => {
    artifactWindows.delete(key);
    if (nativeAgentRunning() && !keepAlive && artifactWindows.size === 0 && (!mainWindow || !mainWindow.isVisible())) { quitting = true; app.quit(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadURL(`${APP_ORIGIN}/#/desktop/artifact/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`);
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
      return { png_base64: (stdout as Buffer).toString("base64") };
    }
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 3840, height: 2160 } });
    const source = output && output !== "primary" ? sources.find((s) => s.display_id === output || s.name === output) : sources[0];
    if (!source) throw new Error("Monitor unavailable");
    return { png_base64: source.thumbnail.toPNG().toString("base64") };
  }
  throw new Error("Unsupported desktop action");
}

function updateTray(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Mostrar Kali", click: () => openMain() },
    { label: "Abrir chat", click: () => openMain("/") },
    { label: "Artefactos", click: () => openMain("/?panel=artifacts") },
    { label: config.avatar.visible ? "Ocultar avatar" : "Mostrar avatar", click: () => setAvatarVisible(!config.avatar.visible) },
    { label: "Configuración", click: () => openMain("/?panel=settings") },
    { type: "separator" },
    { label: "Salir", click: () => { quitting = true; app.quit(); } },
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

if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", (_event, argv) => { if (!handleArgs(argv)) openMain(); });

app.whenReady().then(() => {
  loadConfig();
  if (config.mode === "local") { prepareLocalMode(); void startLocalCore(); }
  protocol.handle("kali", handleAppRequest);
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
    saveConfig();
  });
  ipcMain.handle("desktop:open-artifact", (_event, sid: string, id: string) => openArtifact(sid, id));
  ipcMain.handle("desktop:action", (event, action: string, params: Record<string, unknown>) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Only main window may execute desktop actions");
    return runDesktopAction(action, params);
  });
  ipcMain.on("desktop:presence", (_event, state: { mood: string; emotion: string; text: string; connected: boolean }) => {
    avatarWindow?.webContents.send("desktop:presence", state);
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
