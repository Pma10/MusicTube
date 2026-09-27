import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = join(tmpdir(), `musictube-render-smoke-${process.pid}`);
const publicDir = join(workDir, "public");
const output = join(workDir, "smoke.mp4");
const browserExecutable = process.env.MUSICTUBE_CHROME_PATH;

await mkdir(publicDir, { recursive: true });
await writeFile(
  join(publicDir, "cover.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#807b66"/><circle cx="560" cy="260" r="180" fill="#c8bd98" opacity=".35"/></svg>`,
  "utf8",
);

const inputProps = {
  title: "Render speed smoke",
  artist: "MusicTube",
  lyrics: "[00:00.00]빠른 렌더 테스트",
  audioPath: "",
  coverPath: "cover.svg",
  durationSeconds: 1,
  motionPreset: "soft",
  motionIntensity: 1,
  theme: "warm",
  renderProfile: "fast",
};

let serveUrl;
try {
  serveUrl = await bundle({
    entryPoint: join(root, "remotion", "index.ts"),
    publicDir,
    onProgress: () => undefined,
  });

  const composition = await selectComposition({
    serveUrl,
    id: "MusicTubeVideo",
    inputProps,
    browserExecutable,
    logLevel: "warn",
  });

  if (composition.fps !== 30) {
    throw new Error(`Fast profile should resolve to 30 FPS, got ${composition.fps}`);
  }

  await renderMedia({
    composition,
    serveUrl,
    browserExecutable,
    codec: "h264",
    outputLocation: output,
    inputProps,
    scale: 0.25,
    pixelFormat: "yuv420p",
    videoBitrate: "1M",
    hardwareAcceleration: "disable",
    x264Preset: "veryfast",
    overwrite: true,
    concurrency: 2,
    frameRange: [0, 29],
    logLevel: "warn",
  });

  const info = await stat(output);
  if (info.size <= 0) throw new Error("Fast render smoke test produced an empty MP4");
  console.log(`렌더 확인 완료: ${info.size} bytes`);
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  if (serveUrl && !/^https?:\/\//i.test(serveUrl)) {
    await rm(serveUrl, { recursive: true, force: true }).catch(() => undefined);
  }
}
