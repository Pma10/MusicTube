import { existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("MusicTube local setup");

if (!existsSync(join(root, "node_modules"))) {
  if (isWindows) run("cmd.exe", ["/d", "/s", "/c", "npm install"]);
  else run("npm", ["install"]);
}

const envLocal = join(root, ".env.local");
const envExample = join(root, ".env.example");
if (!existsSync(envLocal) && existsSync(envExample)) {
  copyFileSync(envExample, envLocal);
  console.log("\n.env.local 생성 완료");
}

console.log("\n설정 완료. Python 없이 `npm run local`만 실행하면 됩니다.");
