import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(tmpdir(), `musictube-design-proof-${process.pid}`);
const outputDir = join(root, "artifacts");
const output = join(outputDir, "design-proof.png");

await mkdir(publicDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

const inputProps = {
  title: "Nostalgia",
  artist: "BIG Naughty (서동현)",
  channel: "1H KPOP",
  lyrics: [
    "[00:01.00]문득 네가 생각나는 밤",
    "[00:05.00]우리가 걷던 길 위에 서서",
    "[00:09.00]그때의 온도를 다시 기억해",
    "[00:13.00]조금 느리게 흘러가는 마음",
  ].join("\n"),
  audioPath: "",
  coverPath: null,
  durationSeconds: 30,
  motionPreset: "soft",
  motionIntensity: 1,
  theme: "warm",
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
    logLevel: "warn",
  });

  await renderStill({
    composition,
    serveUrl,
    output,
    inputProps,
    frame: 390,
    imageFormat: "png",
    logLevel: "warn",
  });

  console.log(output);
} finally {
  await rm(publicDir, { recursive: true, force: true }).catch(() => undefined);
  if (serveUrl && !/^https?:\/\//i.test(serveUrl)) {
    await rm(serveUrl, { recursive: true, force: true }).catch(() => undefined);
  }
}
