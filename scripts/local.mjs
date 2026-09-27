import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");
let child = null;
let shuttingDown = false;

function runSetupIfNeeded() {
  if (existsSync(nextCli)) return;
  const result = spawnSync(process.execPath, [join(root, "scripts", "setup-local.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureAcceleration() {
  if (!isWindows || process.env.MUSICTUBE_SKIP_ACCEL_SETUP === "1") return;
  const result = spawnSync(process.execPath, [join(root, "scripts", "setup-acceleration.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (result.error) console.warn(`하드웨어 가속 준비 확인 실패: ${result.error.message}`);
}

function ensureRemotionAacCompatibility() {
  const result = spawnSync(process.execPath, [join(root, "scripts", "patch-remotion-aac.mjs")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureYtDlp() {
  if (process.env.MUSICTUBE_SKIP_YT_DLP_SETUP === "1") return;
  const result = spawnSync(process.execPath, [join(root, "scripts", "setup-ytdlp.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (result.error) console.warn(`yt-dlp 설정 오류: ${result.error.message}`);
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // Starting up.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return false;
}

function openBrowser(url) {
  if (process.env.MUSICTUBE_OPEN === "0") return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Browser auto-open is optional.
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child?.pid && !child.killed) {
    if (isWindows) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(exitCode);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

runSetupIfNeeded();
ensureRemotionAacCompatibility();
ensureAcceleration();
ensureYtDlp();

console.log("\nMusicTube 시작 중…");
child = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: false,
});

child.once("exit", (code, signal) => {
  if (!shuttingDown && code !== 0) {
    console.error(`\nNext.js 종료 (${code ?? "null"}, ${signal ?? "null"})`);
    shutdown(code ?? 1);
  }
});

const ready = await waitFor("http://127.0.0.1:3000");
if (!ready) {
  console.error("\n서버 시작 실패.");
  shutdown(1);
}

console.log("\nMusicTube 실행 중: http://127.0.0.1:3000");
console.log("종료: Ctrl+C\n");
openBrowser("http://127.0.0.1:3000");
