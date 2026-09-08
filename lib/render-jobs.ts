import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import type { MusicTubeRenderProps } from "@/remotion/types";

export type RenderResolution = "1080p" | "1440p" | "4k";
export type RenderJobStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";

export type PreparedRenderJob = {
  jobRoot: string;
  publicDir: string;
  outputPath: string;
  filename: string;
  resolution: RenderResolution;
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

const COMPLETED_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;

async function removePath(path: string | null | undefined) {
  if (!path || /^https?:\/\//i.test(path)) return;
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

function publicJob(job: RenderJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    filename: job.data.filename,
    resolution: job.data.resolution,
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
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: job.data.outputPath,
      inputProps: job.data.props,
      scale: SCALE[job.data.resolution],
      crf: 18,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      enforceAudioTrack: true,
      overwrite: true,
      concurrency: Math.max(1, Math.min(4, Math.floor(cpus().length / 2) || 1)),
      timeoutInMilliseconds: 120_000,
      logLevel: "warn",
      cancelSignal,
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
