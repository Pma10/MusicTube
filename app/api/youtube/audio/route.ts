import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 160 * 1024 * 1024;
const YOUTUBE_ID = /^[\w-]{11}$/;
const MIME_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

function ytDlpCommand() {
  const configuredPath = process.env.YT_DLP_PATH;
  const bundledPath = join(process.cwd(), ".musictube", "yt-dlp", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return configuredPath || (existsSync(bundledPath) ? bundledPath : process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function downloadAudio(videoId: string, folder: string, signal: AbortSignal) {
  const outputTemplate = join(folder, "audio.%(ext)s");
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--no-progress",
    "--no-part",
    "--retries", "2",
    "--fragment-retries", "2",
    "--concurrent-fragments", "4",
    "--socket-timeout", "20",
    "--max-filesize", "160M",
    "--format", "bestaudio[ext=m4a]/bestaudio",
    "--output", outputTemplate,
    "--print", "after_move:filepath",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(ytDlpCommand(), args, { windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-8_000); });
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("yt-dlp를 찾을 수 없습니다. npm run local로 시작해 yt-dlp를 준비해 주세요."));
        return;
      }
      reject(error);
    });
    child.once("close", (code) => {
      if (signal.aborted) return reject(new Error("오디오 가져오기가 취소되었습니다."));
      if (code !== 0) return reject(new Error(stderr.trim().slice(-700) || "yt-dlp가 오디오를 가져오지 못했습니다."));
      const outputPath = stdout.trim().split(/\r?\n/).at(-1)?.trim();
      if (!outputPath) return reject(new Error("yt-dlp가 다운로드된 오디오 파일을 찾지 못했습니다."));
      resolve(outputPath);
    });
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as { videoId?: unknown } | null;
  const videoId = typeof payload?.videoId === "string" ? payload.videoId.trim() : "";
  if (!YOUTUBE_ID.test(videoId)) {
    return NextResponse.json({ error: "올바른 YouTube 곡을 선택해 주세요." }, { status: 400 });
  }

  const folder = mkdtempSync(join(tmpdir(), "musictube-audio-"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4 * 60_000);
  let streaming = false;
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const outputPath = await downloadAudio(videoId, folder, controller.signal);
    const normalizedPath = outputPath.replace(/\\/g, "/");
    const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalizedPath.startsWith(`${normalizedFolder}/`)) {
      throw new Error("yt-dlp returned an invalid audio path.");
    }
    const file = statSync(outputPath);
    if (!file.isFile() || file.size <= 0) throw new Error("Downloaded audio file is empty.");
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "오디오 파일이 160 MB 제한을 초과합니다." }, { status: 413 });
    }

    const extension = outputPath.split(".").at(-1)?.toLowerCase() || "webm";
    const headers = new Headers({
      "Content-Type": MIME_BY_EXTENSION[extension] || "application/octet-stream",
      "Content-Disposition": `inline; filename="youtube-audio.${extension}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-MusicTube-Extension": extension,
    });
    const nodeStream = createReadStream(outputPath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(folder, { recursive: true, force: true });
    };
    nodeStream.once("close", cleanup);
    nodeStream.once("error", cleanup);
    clearTimeout(timeout);
    streaming = true;
    return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube 오디오를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
    if (!streaming) rmSync(folder, { recursive: true, force: true });
  }
}
