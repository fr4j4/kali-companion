// kali-shell/src/sidecar.ts
//
// Sidecar supervisor — spawns and supervises the kali-core Python process.
//
// Ported from kali-home/src/sidecar.rs. The companion's brain lives in
// Python (kali-core); kali-shell is responsible for launching that
// process, waiting for its WebSocket to be listening, and restarting it
// if it crashes.

import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

const DISPLAY_VARS = [
  "WAYLAND_DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "DISPLAY",
];

export interface SidecarHandle {
  child: ChildProcess;
  port: number;
}

export function sidecarPort(): number {
  const v = process.env.KALI_CORE_PORT ?? process.env.KALI_WS_PORT;
  const parsed = v ? Number(v) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8900;
}

function pythonBin(): string {
  return process.env.KALI_PYTHON ?? "python";
}

/**
 * Spawn the Python sidecar once and return the child process.
 *
 * On Linux we wrap the python binary in `nice -n 10` so the agent's CPU
 * priority stays below the foreground app (e.g. Dota 2), same as the
 * original Rust sidecar. On other platforms we skip `nice`.
 */
export function spawnSidecar(port: number): ChildProcess {
  const py = pythonBin();
  const isLinux = process.platform === "linux";

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env.KALI_WS_PORT = String(port);
  env.KALI_HOME_MODE = "electron";

  // Forward display-server vars so the sidecar's capture backend can
  // reach Hyprland/mss. If a var is unset we skip it (mss will report
  // no backend honestly).
  for (const v of DISPLAY_VARS) {
    const val = process.env[v];
    if (val && val.length > 0) env[v] = val;
  }

  let cmd: string;
  let args: string[];
  if (isLinux) {
    cmd = "nice";
    args = ["-n", "10", py, "-m", "kali_core"];
  } else {
    cmd = py;
    args = ["-m", "kali_core"];
  }

  console.log(`[kali-shell] spawning sidecar: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[kali-core] ${d}`),
  );
  child.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[kali-core] ${d}`),
  );

  return child;
}

/**
 * Supervise the sidecar: spawn, restart on exit with 1s backoff.
 * Returns the current child so callers can kill it on shutdown.
 */
export function superviseSidecar(port: number): {
  child: () => ChildProcess | null;
  stop: () => void;
} {
  let current: ChildProcess | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const launch = () => {
    if (stopped) return;
    current = spawnSidecar(port);
    current.on("exit", (code, signal) => {
      console.log(`[kali-shell] sidecar exited (code=${code} signal=${signal})`);
      if (stopped) return;
      console.warn("[kali-shell] sidecar exited; restarting in 1s");
      timer = setTimeout(launch, 1000);
    });
    current.on("error", (err) => {
      console.error(`[kali-shell] sidecar spawn failed: ${err}; retrying in 1s`);
      if (stopped) return;
      timer = setTimeout(launch, 1000);
    });
  };

  launch();

  return {
    child: () => current,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (current && !current.killed) {
        current.kill("SIGTERM");
      }
    },
  };
}

/**
 * Wait until something is listening on `port` (TCP), up to `timeoutMs`.
 * Resolves true if the port became available, false on timeout.
 */
export function waitForPort(port: number, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tryConnect = () => {
      const sock = createConnection({ port, host: "127.0.0.1" }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
        } else {
          setTimeout(tryConnect, 200);
        }
      });
    };
    tryConnect();
  });
}