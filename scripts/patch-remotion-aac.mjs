import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "node_modules", "@remotion", "renderer");
const targets = [
  {
    path: join(packageRoot, "dist", "options", "audio-codec.js"),
    from: "return 'libfdk_aac';",
    to: "return 'aac';",
  },
  {
    path: join(packageRoot, "dist", "esm", "index.mjs"),
    from: 'return "libfdk_aac";',
    to: 'return "aac";',
  },
  {
    path: join(packageRoot, "dist", "options", "audio-codec.d.ts"),
    from: '=> "libfdk_aac" |',
    to: '=> "aac" |',
  },
];

for (const target of targets) {
  let source;
  try {
    source = readFileSync(target.path, "utf8");
  } catch {
    throw new Error(`Remotion 파일을 찾지 못했습니다: ${target.path}`);
  }

  if (!source.includes(target.from)) continue;

  writeFileSync(target.path, source.replace(target.from, target.to), "utf8");
}
