import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { createRenderBackdrop } from "@/lib/render-backdrop";
import { getRenderJob, queueRenderJob, type RenderResolution } from "@/lib/render-jobs";
import {
  parseRenderMultipart,
  RenderMultipartError,
} from "@/lib/render-multipart";
import {
  downloadRemoteAudio,
  downloadRemoteImage,
  MAX_REMOTE_AUDIO_BYTES,
  RemoteMediaError,
} from "@/lib/remote-media";
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
const RESOLUTIONS = new Set<RenderResolution>(["720p", "1080p", "1440p", "4k"]);
const RENDER_PROFILES = new Set<RenderProfile>(["fast", "quality"]);

function text(fields: Record<string, string>, key: string, fallback = "") {
  return (fields[key] ?? fallback).trim();
}

function bounded(value: string, maxLength: number, fallback: string) {
  return (value || fallback).slice(0, maxLength);
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
    const { fields, audio: uploadedAudio, cover } = await parseRenderMultipart(request, publicDir);

    const durationSeconds = Number(text(fields, "duration", "0"));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
      throw new RenderMultipartError("음원 길이 정보가 올바르지 않습니다.", 400);
    }

    const resolution = text(fields, "resolution", "1080p") as RenderResolution;
    if (!RESOLUTIONS.has(resolution)) {
      throw new RenderMultipartError("지원하지 않는 출력 해상도입니다.", 400);
    }

    const profile = text(fields, "renderProfile", "fast") as RenderProfile;
    if (!RENDER_PROFILES.has(profile)) {
      throw new RenderMultipartError("지원하지 않는 렌더 프로필입니다.", 400);
    }

    let audio = uploadedAudio;
    if (audio) {
      await checkRenderStorage({
        durationSeconds,
        resolution,
        profile,
        audioBytes: audio.bytes,
      });
    } else {
      const audioUrl = text(fields, "audioUrl");
      if (!audioUrl) {
        throw new RenderMultipartError("영상 생성에는 음원 파일 또는 음원 URL이 필요합니다.", 400);
      }

      // Fail before a potentially long remote download if the final render clearly cannot fit.
      await checkRenderStorage({
        durationSeconds,
        resolution,
        profile,
        audioBytes: MAX_REMOTE_AUDIO_BYTES,
      });
      audio = await downloadRemoteAudio(audioUrl, publicDir);
    }

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
        coverPath = (await downloadRemoteImage(coverUrl, publicDir)).filename;
      }
    }

    let backdropPath: string | null = null;
    if (coverPath) {
      const generatedPath = "render-backdrop.jpg";
      try {
        await createRenderBackdrop(join(publicDir, coverPath), join(publicDir, generatedPath), theme);
        backdropPath = generatedPath;
      } catch (error) {
        console.warn("[MusicTube] blurred backdrop generation failed", error);
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
      backdropPath,
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
      error instanceof RenderMultipartError || error instanceof RenderStorageError || error instanceof RemoteMediaError
        ? error.status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
