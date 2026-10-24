// Starts Electron, adding --no-sandbox only when the SUID helper isn't usable.
// Without a root-owned, setuid chrome-sandbox (and with AppArmor restricting
// unprivileged user namespaces, e.g. Ubuntu 24.04) Electron aborts with SIGTRAP.
const { spawn } = require("node:child_process");
const { statSync } = require("node:fs");
const { dirname, join } = require("node:path");

const electron = require("electron");
const args = process.argv.slice(2);

function suidSandboxOk() {
  try {
    const st = statSync(join(dirname(electron), "chrome-sandbox"));
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

if (process.platform === "linux" && !args.includes("--no-sandbox") && !suidSandboxOk()) {
  console.warn("[kali-shell] chrome-sandbox no es setuid root; arrancando con --no-sandbox (sin sudo).");
  args.unshift("--no-sandbox");
}

const child = spawn(electron, [".", ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
