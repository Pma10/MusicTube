import { mkdir, rm, writeFile } from "node:fs/promises";
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

const proofCover = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#c8bb91"/>
      <stop offset=".42" stop-color="#8b8368"/>
      <stop offset="1" stop-color="#3f493f"/>
    </linearGradient>
    <filter id="grain"><feTurbulence baseFrequency=".8" numOctaves="3" seed="7"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .12 0"/></filter>
  </defs>
  <rect width="1200" height="1200" fill="url(#g)"/>
  <circle cx="930" cy="240" r="330" fill="#d7caa0" opacity=".22"/>
  <rect x="90" y="110" width="720" height="900" rx="10" fill="#2e342e" opacity=".36" transform="rotate(-4 450 560)"/>
  <rect x="165" y="150" width="690" height="860" rx="8" fill="#c6b990" opacity=".72" transform="rotate(3 510 580)"/>
  <path d="M130 920 C340 690 420 770 590 610 C720 485 910 520 1080 360 L1080 1200 L130 1200Z" fill="#303a34" opacity=".46"/>
  <text x="145" y="1080" font-family="Arial, sans-serif" font-size="84" font-weight="700" fill="#f4edd7" letter-spacing="-4">NOSTALGIA</text>
  <rect width="1200" height="1200" filter="url(#grain)" opacity=".28"/>
</svg>`;
await writeFile(join(publicDir, "cover.svg"), proofCover, "utf8");

const inputProps = {
  title: "Nostalgia",
  artist: "BIG Naughty (서동현)",
  lyrics: [
    "[00:01.00]문득 네가 생각나는 밤",
    "[00:05.00]우리가 아주 오래 걷던 길 위에 다시 서서 잊고 있던 계절과 마음과 목소리까지 천천히 하나씩 떠올려 보는 밤",
    "[00:09.00]그때의 온도를 다시 기억해",
    "[00:13.00]조금 느리게 흘러가는 마음",
  ].join("\n"),
  audioPath: "",
  coverPath: "cover.svg",
  durationSeconds: 30,
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
    logLevel: "warn",
  });

  await renderStill({
    composition,
    serveUrl,
    output,
    inputProps,
    frame: 158,
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
