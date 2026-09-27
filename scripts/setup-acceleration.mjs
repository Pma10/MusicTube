import { createWriteStream, existsSync, mkdirSync, cpSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(root, ".musictube", "ffmpeg");
const binDir = join(cacheRoot, "bin");
const ffmpegExe = join(binDir, "ffmpeg.exe");
const ffprobeExe = join(binDir, "ffprobe.exe");
const remotionExe = join(binDir, "remotion.exe");
const compositorDir = join(root, "node_modules", "@remotion", "compositor-win32-x64-msvc");
const ffmpegVersion = "7.1.1";
const archiveUrl = `https://github.com/GyanD/codexffmpeg/releases/download/${ffmpegVersion}/ffmpeg-${ffmpegVersion}-essentials_build.zip`;

function findFile(directory, targetName) {
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === targetName.toLowerCase()) return full;
    }
  }
  return null;
}

function hasIntelGraphics() {
  const command = "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
  if (result.error || result.status !== 0) return true;
  return /intel|iris|uhd|arc/i.test(result.stdout || "");
}

function qsvProbe() {
  if (!existsSync(ffmpegExe)) return false;
  const result = spawnSync(
    ffmpegExe,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:r=1:d=0.2",
      "-vf",
      "format=nv12",
      "-frames:v",
      "1",
      "-c:v",
      "h264_qsv",
      "-preset",
      "veryfast",
      "-f",
      "null",
      "-",
    ],
    { stdio: "ignore", timeout: 8_000, windowsHide: true },
  );
  return !result.error && result.status === 0;
}

function installedFfmpegVersion() {
  if (!existsSync(ffmpegExe)) return null;
  const result = spawnSync(ffmpegExe, ["-hide_banner", "-version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.match(/^ffmpeg version ([^\s]+)/m)?.[1] ?? null;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`FFmpeg 다운로드 실패: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function extractZip(zipPath, destination) {
  const command = `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg 압축 해제 실패 (code ${result.status ?? "?"})`);
}

async function main() {
  if (process.env.MUSICTUBE_SKIP_ACCEL_SETUP === "1") return;
  if (process.platform !== "win32" || process.arch !== "x64") return;

  if (!hasIntelGraphics() && process.env.MUSICTUBE_FORCE_ACCEL_SETUP !== "1") {
    console.log("Intel GPU 없음. Quick Sync 건너뜀.");
    return;
  }

  if (
    installedFfmpegVersion() === ffmpegVersion &&
    existsSync(ffprobeExe) &&
    existsSync(remotionExe)
  ) {
    console.log(qsvProbe()
      ? "Quick Sync 사용 가능"
      : "Quick Sync 사용 불가. 그래픽 드라이버를 확인하세요.");
    return;
  }

  if (!existsSync(compositorDir)) {
    console.warn("npm install을 먼저 실행하세요.");
    return;
  }

  mkdirSync(cacheRoot, { recursive: true });
  const zipPath = join(cacheRoot, "ffmpeg-release-essentials.zip");
  const extractDir = join(cacheRoot, "extract");

  try {
    console.log("\nQuick Sync 준비 중…");
    rmSync(extractDir, { recursive: true, force: true });
    await download(archiveUrl, zipPath);
    mkdirSync(extractDir, { recursive: true });
    extractZip(zipPath, extractDir);

    const downloadedFfmpeg = findFile(extractDir, "ffmpeg.exe");
    const downloadedFfprobe = findFile(extractDir, "ffprobe.exe");
    if (!downloadedFfmpeg || !downloadedFfprobe) {
      throw new Error("압축 파일에서 ffmpeg.exe / ffprobe.exe를 찾지 못했습니다.");
    }

    rmSync(binDir, { recursive: true, force: true });
    cpSync(compositorDir, binDir, { recursive: true });
    copyFileSync(downloadedFfmpeg, ffmpegExe);
    copyFileSync(downloadedFfprobe, ffprobeExe);

    console.log(qsvProbe()
      ? "Quick Sync 사용 가능"
      : "Quick Sync 사용 불가. Intel 그래픽 드라이버를 확인하세요.");
  } catch (error) {
    console.warn(`하드웨어 가속 준비를 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

await main();
