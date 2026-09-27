import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binaryPath = join(root, ".musictube", "yt-dlp", binaryName);
const temporaryPath = `${binaryPath}.download`;

if (process.env.MUSICTUBE_SKIP_YT_DLP_SETUP === "1") process.exit(0);
if (existsSync(binaryPath)) {
  console.log("yt-dlp 준비됨.");
  process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64") {
  console.log("yt-dlp를 설치하거나 YT_DLP_PATH에 실행 파일 경로를 지정하세요.");
  process.exit(0);
}

const releaseBase = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
mkdirSync(dirname(binaryPath), { recursive: true });

try {
  console.log("yt-dlp 설치 중…");
  const [binaryResponse, checksumResponse] = await Promise.all([
    fetch(`${releaseBase}/yt-dlp.exe`, { redirect: "follow" }),
    fetch(`${releaseBase}/SHA2-256SUMS`, { redirect: "follow" }),
  ]);
  if (!binaryResponse.ok || !checksumResponse.ok) {
    throw new Error(`yt-dlp 다운로드 실패 (HTTP ${binaryResponse.status}/${checksumResponse.status}).`);
  }

  const [binary, checksums] = await Promise.all([
    binaryResponse.arrayBuffer(),
    checksumResponse.text(),
  ]);
  const checksum = checksums.match(/^([a-f\d]{64})\s+\*?yt-dlp\.exe\s*$/im)?.[1]?.toLowerCase();
  if (!checksum) throw new Error("yt-dlp 체크섬을 찾을 수 없습니다.");
  const actual = createHash("sha256").update(Buffer.from(binary)).digest("hex");
  if (actual !== checksum) throw new Error("yt-dlp 체크섬이 일치하지 않습니다.");

  writeFileSync(temporaryPath, Buffer.from(binary));
  renameSync(temporaryPath, binaryPath);
  console.log("yt-dlp 준비됨.");
} catch (error) {
  rmSync(temporaryPath, { force: true });
  console.warn(error instanceof Error ? error.message : "yt-dlp 설정 실패.");
  console.warn("yt-dlp를 설치하거나 YT_DLP_PATH에 실행 파일 경로를 지정하세요.");
}
