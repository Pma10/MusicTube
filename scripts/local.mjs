import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const venvPython = join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const npmCommand = isWindows ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function runSetupIfNeeded() {
  if (existsSync(venvPython) && existsSync(join(root, "node_modules"))) return;
  const result = spawnSync(process.execPath, [join(root, "scripts", "setup-local.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function start(command, args, label, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`\n${label} 종료: code=${code ?? "null"}, signal=${signal ?? "null"}`);
      void shutdown(code ?? 1);
    }
  });
  return child;
}

async function waitFor(url, timeoutMs = 45_000) {
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

async function terminate(child) {
  if (!child.pid || child.killed) return;
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...children].map((child) => terminate(child)));
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

runSetupIfNeeded();

console.log("\nMusicTube Local Studio 시작 중...");
start(
  venvPython,
  ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8765"],
  "Genie bridge",
  { PYTHONUNBUFFERED: "1" },
);
start(npmCommand, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"], "Next.js");

const [genieReady, webReady] = await Promise.all([
  waitFor("http://127.0.0.1:8765/health"),
  waitFor("http://127.0.0.1:3000"),
]);

if (!genieReady || !webReady) {
  console.error(`\n시작 실패: Genie=${genieReady ? "OK" : "FAIL"}, Web=${webReady ? "OK" : "FAIL"}`);
  await shutdown(1);
} else {
  console.log("\nMusicTube 준비 완료: http://127.0.0.1:3000");
  console.log("종료하려면 Ctrl+C를 누르세요. 첫 MP4 렌더는 Remotion 브라우저 설치 때문에 조금 더 걸릴 수 있습니다.\n");
  openBrowser("http://127.0.0.1:3000");
}
