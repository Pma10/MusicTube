import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
  type Bitrate,
} from "@remotion/renderer";
import type { MusicTubeRenderProps, RenderProfile } from "@/remotion/types";

export type RenderResolution = "1080p" | "1440p" | "4k";
export type RenderJobStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";
export type RenderEncoder = "intel-qsv" | "nvidia-nvenc" | "apple-videotoolbox" | "software-x264";
type RemotionHardwareAcceleration = "disable" | "if-possible";
type FfmpegOverride = (info: { type: "pre-stitcher" | "stitcher"; args: string[] }) => string[];

type EncoderSelection = {
  encoder: RenderEncoder;
  binariesDirectory: string | null;
};

export type PreparedRenderJob = {
  jobRoot: string;
  publicDir: string;
  outputPath: string;
  filename: string;
  resolution: RenderResolution;
  profile: RenderProfile;
  props: MusicTubeRenderProps;
};

type RenderJob = {
  id: string;
  status: RenderJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  data: PreparedRenderJob;
  cancel: (() => void) | null;
  outputBytes: number | null;
  resolvedConcurrency: number | null;
  parallelEncoding: boolean | null;
  encoder: RenderEncoder;
  binariesDirectory: string | null;
};

type RenderRuntimeState = {
  jobs: Map<string, RenderJob>;
  queue: Promise<void>;
};

declare global {
  var __musicTubeRenderRuntime: RenderRuntimeState | undefined;
}

const runtimeState: RenderRuntimeState =
  globalThis.__musicTubeRenderRuntime ??
  (globalThis.__musicTubeRenderRuntime = {
    jobs: new Map<string, RenderJob>(),
    queue: Promise.resolve(),
  });

const SCALE: Record<RenderResolution, number> = {
  "1080p": 1,
  "1440p": 4 / 3,
  "4k": 2,
};

const VIDEO_BITRATES: Record<RenderProfile, Record<RenderResolution, Bitrate>> = {
  fast: {
    "1080p": "8M",
    "1440p": "14M",
    "4k": "28M",
  },
  quality: {
    "1080p": "12M",
    "1440p": "22M",
    "4k": "45M",
  },
};

const ENCODER_LABELS: Record<RenderEncoder, string> = {
  "intel-qsv": "Intel Quick Sync (QSV)",
  "nvidia-nvenc": "NVIDIA NVENC",
  "apple-videotoolbox": "Apple VideoToolbox",
  "software-x264": "CPU x264",
};

const COMPLETED_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;
let cachedEncoderSelection: EncoderSelection | null = null;

function renderFps(profile: RenderProfile) {
  return profile === "quality" ? 60 : 30;
}

function resolveRenderConcurrency(profile: RenderProfile) {
  const configured = Number(process.env.MUSICTUBE_RENDER_CONCURRENCY);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.max(1, Math.min(16, configured));
  }

  const cores = Math.max(1, availableParallelism());
  if (profile === "fast") {
    return Math.max(1, Math.min(8, cores <= 2 ? cores : cores - 1));
  }

  return Math.max(1, Math.min(6, Math.ceil(cores * 0.75)));
}

function processSucceeded(command: string, args: string[], timeout = 5_000) {
  try {
    const result = spawnSync(command, args, {
      stdio: "ignore",
      timeout,
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function hasNvidiaGpu() {
  if (process.platform !== "win32" && process.platform !== "linux") return false;
  return processSucceeded("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], 3_000);
}

function qsvBinariesDirectory() {
  if (process.platform !== "win32" || process.arch !== "x64") return null;
  const configured = process.env.MUSICTUBE_FFMPEG_BIN_DIR?.trim();
  const directory = configured || join(process.cwd(), ".musictube", "ffmpeg", "bin");
  const required = ["ffmpeg.exe", "ffprobe.exe", "remotion.exe"].map((name) => join(directory, name));
  return required.every((path) => existsSync(path)) ? directory : null;
}

function canUseIntelQsv(directory: string) {
  return processSucceeded(
    join(directory, "ffmpeg.exe"),
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
    8_000,
  );
}

function softwareEncoder(): EncoderSelection {
  return { encoder: "software-x264", binariesDirectory: null };
}

function resolveEncoderSelection(): EncoderSelection {
  if (cachedEncoderSelection) return cachedEncoderSelection;

  const forced = (process.env.MUSICTUBE_RENDER_ENCODER ?? "auto").trim().toLowerCase();
  const qsvDirectory = qsvBinariesDirectory();
  const qsvAvailable = Boolean(qsvDirectory && canUseIntelQsv(qsvDirectory));
  const nvidiaAvailable = hasNvidiaGpu();

  const pickQsv = (): EncoderSelection | null =>
    qsvAvailable && qsvDirectory ? { encoder: "intel-qsv", binariesDirectory: qsvDirectory } : null;
  const pickNvenc = (): EncoderSelection | null =>
    nvidiaAvailable ? { encoder: "nvidia-nvenc", binariesDirectory: null } : null;

  if (forced === "qsv" || forced === "intel-qsv") {
    cachedEncoderSelection = pickQsv() ?? softwareEncoder();
    return cachedEncoderSelection;
  }
  if (forced === "nvenc" || forced === "nvidia-nvenc") {
    cachedEncoderSelection = pickNvenc() ?? softwareEncoder();
    return cachedEncoderSelection;
  }
  if (forced === "x264" || forced === "software-x264") {
    cachedEncoderSelection = softwareEncoder();
    return cachedEncoderSelection;
  }

  if (process.platform === "darwin") {
    cachedEncoderSelection = { encoder: "apple-videotoolbox", binariesDirectory: null };
    return cachedEncoderSelection;
  }

  if (process.platform === "win32") {
    cachedEncoderSelection = pickNvenc() ?? pickQsv() ?? softwareEncoder();
    return cachedEncoderSelection;
  }

  if (process.platform === "linux") {
    cachedEncoderSelection = pickNvenc() ?? softwareEncoder();
    return cachedEncoderSelection;
  }

  cachedEncoderSelection = softwareEncoder();
  return cachedEncoderSelection;
}

function remotionHardwareAcceleration(encoder: RenderEncoder): RemotionHardwareAcceleration {
  return encoder === "nvidia-nvenc" || encoder === "apple-videotoolbox" ? "if-possible" : "disable";
}

function intelQsvOverride(profile: RenderProfile): FfmpegOverride {
  return ({ args }) => {
    const next = [...args];
    let qsvVideoEncode = false;

    for (let index = 0; index < next.length - 1; index += 1) {
      if (next[index] === "-c:v" && next[index + 1] === "libx264") {
        next[index + 1] = "h264_qsv";
        qsvVideoEncode = true;
      }
    }

    if (!qsvVideoEncode) return next;

    const cleaned: string[] = [];
    for (let index = 0; index < next.length; index += 1) {
      const arg = next[index];
      if (arg === "-preset" && index + 1 < next.length) {
        index += 1;
        continue;
      }
      if (arg === "-pix_fmt" && index + 1 < next.length) {
        cleaned.push(arg, "nv12");
        index += 1;
        continue;
      }
      cleaned.push(arg);
    }

    const output = cleaned.pop();
    if (!output) return cleaned;
    cleaned.push(
      "-preset",
      profile === "fast" ? "veryfast" : "medium",
      "-async_depth",
      profile === "fast" ? "6" : "4",
      output,
    );
    return cleaned;
  };
}

async function removePath(path: string | null | undefined) {
  if (!path || /^https?:\/\//i.test(path)) return;
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

function publicJob(job: RenderJob) {
  const accelerated = job.encoder !== "software-x264";
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    filename: job.data.filename,
    resolution: job.data.resolution,
    profile: job.data.profile,
    fps: renderFps(job.data.profile),
    resolvedConcurrency: job.resolvedConcurrency,
    parallelEncoding: job.parallelEncoding,
    hardwareAcceleration: accelerated ? "enabled" as const : "disabled" as const,
    encoder: job.encoder,
    encoderLabel: ENCODER_LABELS[job.encoder],
    outputBytes: job.outputBytes,
    downloadUrl: job.status === "completed" ? `/api/render/${job.id}/download` : null,
  };
}

async function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of runtimeState.jobs) {
    const ttl = job.status === "completed" ? COMPLETED_TTL_MS : FAILED_TTL_MS;
    if (["completed", "failed", "cancelled"].includes(job.status) && now - job.updatedAt > ttl) {
      await removePath(job.data.jobRoot);
      runtimeState.jobs.delete(id);
    }
  }
}

async function processJob(jobId: string) {
  const job = runtimeState.jobs.get(jobId);
  if (!job || job.status !== "queued") return;

  const { cancel, cancelSignal } = makeCancelSignal();
  job.status = "rendering";
  job.progress = 0;
  job.updatedAt = Date.now();
  job.cancel = cancel;

  const concurrency = resolveRenderConcurrency(job.data.profile);
  const useSoftwareEncoding = job.encoder === "software-x264";
  const hardwareAcceleration = remotionHardwareAcceleration(job.encoder);
  const ffmpegOverride = job.encoder === "intel-qsv" ? intelQsvOverride(job.data.profile) : undefined;
  let serveUrl: string | null = null;

  try {
    serveUrl = await bundle({
      entryPoint: resolve(process.cwd(), "remotion", "index.ts"),
      publicDir: job.data.publicDir,
      onProgress: () => undefined,
    });

    const composition = await selectComposition({
      serveUrl,
      id: "MusicTubeVideo",
      inputProps: job.data.props,
      timeoutInMilliseconds: 120_000,
      logLevel: "warn",
      binariesDirectory: job.binariesDirectory,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: job.data.outputPath,
      inputProps: job.data.props,
      scale: SCALE[job.data.resolution],
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "192K",
      videoBitrate: VIDEO_BITRATES[job.data.profile][job.data.resolution],
      hardwareAcceleration,
      ffmpegOverride,
      binariesDirectory: job.binariesDirectory,
      x264Preset: useSoftwareEncoding
        ? job.data.profile === "fast"
          ? "veryfast"
          : "medium"
        : undefined,
      enforceAudioTrack: true,
      overwrite: true,
      concurrency,
      timeoutInMilliseconds: 120_000,
      logLevel: "warn",
      cancelSignal,
      onStart: ({ resolvedConcurrency, parallelEncoding }) => {
        const current = runtimeState.jobs.get(jobId);
        if (!current) return;
        current.resolvedConcurrency = resolvedConcurrency;
        current.parallelEncoding = parallelEncoding;
        current.updatedAt = Date.now();
      },
      onProgress: ({ progress }) => {
        const current = runtimeState.jobs.get(jobId);
        if (!current || current.status !== "rendering") return;
        current.progress = Math.max(0, Math.min(1, progress));
        current.updatedAt = Date.now();
      },
    });

    const current = runtimeState.jobs.get(jobId);
    if (!current || current.status === "cancelled") return;

    const info = await stat(job.data.outputPath);
    current.status = "completed";
    current.progress = 1;
    current.updatedAt = Date.now();
    current.cancel = null;
    current.outputBytes = info.size;

    await removePath(job.data.publicDir);
  } catch (error) {
    const current = runtimeState.jobs.get(jobId);
    if (!current) return;

    if (current.status !== "cancelled") {
      current.status = "failed";
      current.error = error instanceof Error ? error.message : "영상 생성에 실패했습니다.";
      current.updatedAt = Date.now();
      current.cancel = null;
    }

    await removePath(job.data.jobRoot);
  } finally {
    await removePath(serveUrl);
  }
}

export async function queueRenderJob(data: PreparedRenderJob) {
  await pruneExpiredJobs();

  const selection = resolveEncoderSelection();
  const id = randomUUID();
  const now = Date.now();
  const job: RenderJob = {
    id,
    status: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    error: null,
    data,
    cancel: null,
    outputBytes: null,
    resolvedConcurrency: null,
    parallelEncoding: null,
    encoder: selection.encoder,
    binariesDirectory: selection.binariesDirectory,
  };
  runtimeState.jobs.set(id, job);

  const render = runtimeState.queue.then(() => processJob(id));
  runtimeState.queue = render.catch(() => undefined);

  return publicJob(job);
}

export async function getRenderJob(jobId: string) {
  await pruneExpiredJobs();
  const job = runtimeState.jobs.get(jobId);
  return job ? publicJob(job) : null;
}

export async function getRenderJobFile(jobId: string) {
  await pruneExpiredJobs();
  const job = runtimeState.jobs.get(jobId);
  if (!job || job.status !== "completed") return null;
  return {
    path: job.data.outputPath,
    filename: job.data.filename,
    size: job.outputBytes ?? (await stat(job.data.outputPath)).size,
  };
}

export async function cancelRenderJob(jobId: string) {
  const job = runtimeState.jobs.get(jobId);
  if (!job) return false;
  if (["completed", "failed", "cancelled"].includes(job.status)) return false;

  job.status = "cancelled";
  job.updatedAt = Date.now();
  job.error = null;
  job.cancel?.();
  job.cancel = null;
  await removePath(job.data.jobRoot);
  return true;
}

export async function cleanupRenderJob(jobId: string) {
  const job = runtimeState.jobs.get(jobId);
  if (!job) return;
  await removePath(job.data.jobRoot);
  runtimeState.jobs.delete(jobId);
}
