import { readdir, rm, stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderResolution } from "@/lib/render-jobs";
import type { RenderProfile } from "@/remotion/types";

const RENDER_DIR_PREFIX = "musictube-render-";
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const BASE_RESERVE_BYTES = 512 * 1024 * 1024;
const WORKSPACE_MULTIPLIER = 2.25;

const VIDEO_BITRATE_BPS: Record<RenderProfile, Record<RenderResolution, number>> = {
  fast: {
    "1080p": 8_000_000,
    "1440p": 14_000_000,
    "4k": 28_000_000,
  },
  quality: {
    "1080p": 12_000_000,
    "1440p": 22_000_000,
    "4k": 45_000_000,
  },
};

const AUDIO_BITRATE_BPS = 192_000;
let lastCleanupAt = 0;
let cleanupPromise: Promise<void> | null = null;

export class RenderStorageError extends Error {
  constructor(
    message: string,
    public readonly status = 507,
  ) {
    super(message);
    this.name = "RenderStorageError";
  }
}

export function estimateRenderOutputBytes(
  durationSeconds: number,
  resolution: RenderResolution,
  profile: RenderProfile,
) {
  const bitsPerSecond = VIDEO_BITRATE_BPS[profile][resolution] + AUDIO_BITRATE_BPS;
  return Math.ceil((bitsPerSecond * durationSeconds) / 8);
}

export async function checkRenderStorage(input: {
  durationSeconds: number;
  resolution: RenderResolution;
  profile: RenderProfile;
  audioBytes: number;
}) {
  const estimatedOutputBytes = estimateRenderOutputBytes(
    input.durationSeconds,
    input.resolution,
    input.profile,
  );
  const requiredFreeBytes = Math.ceil(
    estimatedOutputBytes * WORKSPACE_MULTIPLIER + input.audioBytes + BASE_RESERVE_BYTES,
  );

  try {
    const stats = await statfs(tmpdir());
    const availableFreeBytes = stats.bavail * stats.bsize;
    if (availableFreeBytes < requiredFreeBytes) {
      const neededGb = (requiredFreeBytes / 1024 ** 3).toFixed(1);
      const availableGb = (availableFreeBytes / 1024 ** 3).toFixed(1);
      throw new RenderStorageError(
        `렌더 임시 저장공간이 부족합니다. 약 ${neededGb} GB가 필요하지만 ${availableGb} GB만 사용 가능합니다.`,
      );
    }
    return { estimatedOutputBytes, requiredFreeBytes, availableFreeBytes };
  } catch (error) {
    if (error instanceof RenderStorageError) throw error;
    return { estimatedOutputBytes, requiredFreeBytes, availableFreeBytes: null };
  }
}

async function latestRenderActivityMs(path: string, fallback: number) {
  let latest = fallback;
  const candidates = [join(path, "video.mp4"), join(path, "public")];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null);
    if (info) latest = Math.max(latest, info.mtimeMs);
  }
  return latest;
}

async function cleanupStaleRenderDirectoriesNow() {
  const root = tmpdir();
  const now = Date.now();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(RENDER_DIR_PREFIX))
      .map(async (entry) => {
        const path = join(root, entry.name);
        const info = await stat(path).catch(() => null);
        if (!info) return;

        // A long render may keep the root directory entry itself unchanged while FFmpeg
        // continues writing video.mp4. Use the newest known activity instead of root mtime
        // alone so a separate render request cannot prune a still-active long job.
        const latestActivity = await latestRenderActivityMs(path, info.mtimeMs);
        if (now - latestActivity <= ORPHAN_MAX_AGE_MS) return;
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }),
  );
}

export async function cleanupStaleRenderDirectories() {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = cleanupStaleRenderDirectoriesNow()
    .catch(() => undefined)
    .finally(() => {
      lastCleanupAt = Date.now();
      cleanupPromise = null;
    });
  return cleanupPromise;
}
