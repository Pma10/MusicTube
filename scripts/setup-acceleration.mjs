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
const archiveUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

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

  if (existsSync(ffmpegExe) && existsSync(ffprobeExe) && existsSync(remotionExe)) {
    console.log(qsvProbe()
      ? "Intel Quick Sync 준비됨: h264_qsv 사용 가능"
      : "로컬 FFmpeg는 준비됐지만 h264_qsv를 사용할 수 없습니다. Intel 그래픽 드라이버를 확인하세요.");
    return;
  }

  if (!existsSync(compositorDir)) {
    console.warn("Remotion Windows compositor가 아직 없습니다. 먼저 npm install을 실행하세요.");
    return;
  }

  mkdirSync(cacheRoot, { recursive: true });
  const zipPath = join(cacheRoot, "ffmpeg-release-essentials.zip");
  const extractDir = join(cacheRoot, "extract");

  try {
    console.log("\nIntel Quick Sync용 FFmpeg를 한 번만 준비합니다...");
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
      ? "Intel Quick Sync 활성화 준비 완료 (h264_qsv)"
      : "FFmpeg 설치는 완료됐지만 h264_qsv 초기화에 실패했습니다. 최신 Intel Graphics Driver를 설치하면 자동으로 다시 감지됩니다.");
  } catch (error) {
    console.warn(`하드웨어 가속 준비를 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

await main();
