import { existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const venvPython = join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function canRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "ignore", shell: false });
  return !result.error && result.status === 0;
}

function findPython() {
  const candidates = isWindows
    ? [
        { command: "py", prefix: ["-3"] },
        { command: "python", prefix: [] },
        { command: "python3", prefix: [] },
      ]
    : [
        { command: "python3", prefix: [] },
        { command: "python", prefix: [] },
      ];

  for (const candidate of candidates) {
    if (canRun(candidate.command, [...candidate.prefix, "--version"])) return candidate;
  }
  return null;
}

console.log("MusicTube local setup");

if (!existsSync(join(root, "node_modules"))) {
  run(isWindows ? "npm.cmd" : "npm", ["install"]);
}

if (!existsSync(venvPython)) {
  const python = findPython();
  if (!python) {
    console.error("\nPython 3를 찾지 못했습니다. Python 3.11+를 설치한 뒤 다시 실행해 주세요.");
    process.exit(1);
  }
  run(python.command, [...python.prefix, "-m", "venv", ".venv"]);
}

run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "backend/requirements.txt"]);

const envLocal = join(root, ".env.local");
const envExample = join(root, ".env.example");
if (!existsSync(envLocal) && existsSync(envExample)) {
  copyFileSync(envExample, envLocal);
  console.log("\n.env.local 생성 완료");
}

console.log("\n설정 완료. 이제 `npm run local`을 실행하면 됩니다.");
