import { existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    if (allowFailure) {
      console.warn(result.error.message);
      return;
    }
    throw result.error;
  }
  if (result.status !== 0 && !allowFailure) process.exit(result.status ?? 1);
}

console.log("로컬 설정 중…");

if (!existsSync(join(root, "node_modules"))) {
  if (isWindows) run("cmd.exe", ["/d", "/s", "/c", "npm install"]);
  else run("npm", ["install"]);
}

run(process.execPath, [join(root, "scripts", "patch-remotion-aac.mjs")]);

const envLocal = join(root, ".env.local");
const envExample = join(root, ".env.example");
if (!existsSync(envLocal) && existsSync(envExample)) {
  copyFileSync(envExample, envLocal);
  console.log("\n.env.local 생성됨");
}

run(process.execPath, [join(root, "scripts", "setup-ytdlp.mjs")], { allowFailure: true });

if (isWindows && process.env.MUSICTUBE_SKIP_ACCEL_SETUP !== "1") {
  run(process.execPath, [join(root, "scripts", "setup-acceleration.mjs")], { allowFailure: true });
}

console.log("\n설정 완료.");
