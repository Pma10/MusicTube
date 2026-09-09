import { lookup } from "node:dns/promises";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getRenderJob, queueRenderJob, type RenderResolution } from "@/lib/render-jobs";
import {
  MAX_RENDER_COVER_BYTES,
  parseRenderMultipart,
  RenderMultipartError,
} from "@/lib/render-multipart";
import {
  checkRenderStorage,
  cleanupStaleRenderDirectories,
  RenderStorageError,
} from "@/lib/render-storage";
import type {
  MusicTubeRenderProps,
  RenderMotionPreset,
  RenderProfile,
  RenderThemePreset,
} from "@/remotion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DURATION_SECONDS = 6 * 60 * 60;
const MAX_REDIRECTS = 4;

const RESOLUTIONS = new Set<RenderResolution>(["1080p", "1440p", "4k"]);
const RENDER_PROFILES = new Set<RenderProfile>(["fast", "quality"]);

function text(fields: Record<string, string>, key: string, fallback = "") {
  return (fields[key] ?? fallback).trim();
}

function bounded(value: string, maxLength: number, fallback: string) {
  return (value || fallback).slice(0, maxLength);
}

function coverExtension(contentType: string) {
  const type = contentType.toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  return ".jpg";
}

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(value: string) {
  const ip = value.toLowerCase().split("%")[0];
  return (
    ip === "::" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb") ||
    ip.startsWith("::ffff:127.") ||
    ip.startsWith("::ffff:10.") ||
    ip.startsWith("::ffff:192.168.")
  );
}

function isPrivateAddress(value: string) {
  const family = isIP(value);
  if (family === 4) return isPrivateIpv4(value);
  if (family === 6) return isPrivateIpv6(value);
  return true;
}

async function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new Error("HTTPS cover URLs only");
  if (url.username || url.password) throw new Error("Credentials in cover URLs are not allowed");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("Local cover URLs are not allowed");

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("Private network cover URLs are not allowed");
    return;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Cover host resolves to a private network address");
  }
}

async function downloadCover(rawUrl: string) {
  let current = new URL(rawUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttps(current);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "image/*", "User-Agent": "MusicTube/0.1 renderer" },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Cover source returned an invalid redirect");
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) throw new Error(`Cover source returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) throw new Error("Cover URL did not return an image");

    const announcedSize = Number(response.headers.get("content-length") || 0);
    if (announcedSize > MAX_RENDER_COVER_BYTES) throw new Error("Cover image is larger than 20 MB");

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_RENDER_COVER_BYTES) throw new Error("Cover image is larger than 20 MB");
    return { data, extension: coverExtension(contentType) };
  }

  throw new Error("Too many cover redirects");
}

function outputFilename(title: string, artist: string, resolution: RenderResolution) {
  const raw = `${artist ? `${artist} - ` : ""}${title || "MusicTube"}`;
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${safe || "MusicTube"} [${resolution === "4k" ? "4K" : resolution}].mp4`;
}

async function cleanup(path: string) {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

async function waitForFinishedJob(jobId: string) {
  while (true) {
    const current = await getRenderJob(jobId);
    if (!current) throw new Error("렌더 작업이 사라졌습니다.");
    if (current.status === "completed") return current;
    if (current.status === "failed") throw new Error(current.error || "영상 생성에 실패했습니다.");
    if (current.status === "cancelled") throw new Error("영상 생성이 취소되었습니다.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  }
}

export async function POST(request: Request) {
  const jobRoot = join(tmpdir(), `musictube-render-${crypto.randomUUID()}`);
  const publicDir = join(jobRoot, "public");
  const outputPath = join(jobRoot, "video.mp4");

  try {
    await cleanupStaleRenderDirectories();
    await mkdir(publicDir, { recursive: true });
    const { fields, audio, cover } = await parseRenderMultipart(request, publicDir);

    const durationSeconds = Number(text(fields, "duration", "0"));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
      return NextResponse.json({ error: "음원 길이 정보가 올바르지 않습니다." }, { status: 400 });
    }

    const resolution = text(fields, "resolution", "1080p") as RenderResolution;
    if (!RESOLUTIONS.has(resolution)) {
      return NextResponse.json({ error: "지원하지 않는 출력 해상도입니다." }, { status: 400 });
    }

    const profile = text(fields, "renderProfile", "fast") as RenderProfile;
    if (!RENDER_PROFILES.has(profile)) {
      return NextResponse.json({ error: "지원하지 않는 렌더 프로필입니다." }, { status: 400 });
    }

    await checkRenderStorage({
      durationSeconds,
      resolution,
      profile,
      audioBytes: audio.bytes,
    });

    const motionPresetRaw = text(fields, "motionPreset", "soft");
    const motionPreset: RenderMotionPreset = ["soft", "cinematic", "minimal"].includes(motionPresetRaw)
      ? (motionPresetRaw as RenderMotionPreset)
      : "soft";
    const themeRaw = text(fields, "theme", "warm");
    const theme: RenderThemePreset = ["warm", "cool", "mono"].includes(themeRaw)
      ? (themeRaw as RenderThemePreset)
      : "warm";
    const motionIntensityRaw = Number(text(fields, "motionIntensity", "1"));
    const motionIntensity = Number.isFinite(motionIntensityRaw)
      ? Math.max(0.6, Math.min(1.4, motionIntensityRaw))
      : 1;

    let coverPath: string | null = cover?.filename ?? null;
    if (!coverPath) {
      const coverUrl = text(fields, "coverUrl");
      if (coverUrl) {
        const downloaded = await downloadCover(coverUrl);
        const filename = `cover${downloaded.extension}`;
        await writeFile(join(publicDir, filename), downloaded.data);
        coverPath = filename;
      }
    }

    const title = bounded(text(fields, "title"), 160, "Untitled");
    const artist = bounded(text(fields, "artist"), 160, "Unknown Artist");
    const props: MusicTubeRenderProps = {
      title,
      artist,
      lyrics: text(fields, "lyrics").slice(0, 250_000),
      audioPath: audio.filename,
      coverPath,
      durationSeconds,
      motionPreset,
      motionIntensity,
      theme,
      renderProfile: profile,
    };

    const job = await queueRenderJob({
      jobRoot,
      publicDir,
      outputPath,
      filename: outputFilename(title, artist, resolution),
      resolution,
      profile,
      props,
    });

    const asyncMode = new URL(request.url).searchParams.get("async") === "1";
    if (asyncMode) return NextResponse.json(job, { status: 202 });

    const completed = await waitForFinishedJob(job.id);
    if (!completed.downloadUrl) throw new Error("완료된 영상의 다운로드 경로가 없습니다.");
    return NextResponse.redirect(new URL(completed.downloadUrl, request.url), 303);
  } catch (error) {
    await cleanup(jobRoot);
    const message = error instanceof Error ? error.message : "영상 생성 요청에 실패했습니다.";
    const status =
      error instanceof RenderMultipartError || error instanceof RenderStorageError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
