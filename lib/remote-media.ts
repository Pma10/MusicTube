import { lookup } from "node:dns/promises";
import { open, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, join } from "node:path";

export const MAX_REMOTE_AUDIO_BYTES = 160 * 1024 * 1024;
export const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

const MAX_REDIRECTS = 4;
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

type RemoteMediaKind = "audio" | "image";

type FetchRemoteOptions = {
  kind: RemoteMediaKind;
  range?: string | null;
  userAgent?: string;
};

export class RemoteMediaError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "RemoteMediaError";
  }
}

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(value: string) {
  const ip = value.toLowerCase().split("%")[0];
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return (
    ip === "::" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb") ||
    ip.startsWith("ff")
  );
}

function isPrivateAddress(value: string) {
  const family = isIP(value);
  if (family === 4) return isPrivateIpv4(value);
  if (family === 6) return isPrivateIpv6(value);
  return true;
}

async function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new RemoteMediaError("HTTPS URL만 사용할 수 있습니다.", 400);
  if (url.username || url.password) throw new RemoteMediaError("URL에 인증 정보를 포함할 수 없습니다.", 400);

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan")
  ) {
    throw new RemoteMediaError("로컬 네트워크 주소는 사용할 수 없습니다.", 400);
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new RemoteMediaError("사설 네트워크 주소는 사용할 수 없습니다.", 400);
    return;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteMediaError("원격 미디어 호스트를 확인할 수 없습니다.", 502);
  }

  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new RemoteMediaError("원격 미디어 호스트가 사설 네트워크 주소로 확인되었습니다.", 400);
  }
}

function contentType(response: Response) {
  return response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function audioExtension(url: URL, mimeType: string) {
  const extension = extname(url.pathname).toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension)) return extension;
  const mime = mimeType.toLowerCase();
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("flac")) return ".flac";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("opus")) return ".opus";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  return null;
}

function imageExtension(url: URL, mimeType: string) {
  const mime = mimeType.toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  const extension = extname(url.pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return extension === ".jpeg" ? ".jpg" : extension;
  return null;
}

function validateKind(url: URL, response: Response, kind: RemoteMediaKind) {
  if (!response.ok) {
    throw new RemoteMediaError(`원격 미디어가 HTTP ${response.status}를 반환했습니다.`, 502);
  }

  const mimeType = contentType(response);
  if (kind === "audio") {
    const extension = audioExtension(url, mimeType);
    const audioLike = mimeType.startsWith("audio/") || mimeType === "application/octet-stream" || extension !== null;
    if (!audioLike || !extension) throw new RemoteMediaError("URL이 지원하는 음원 파일을 반환하지 않았습니다.", 415);
    return { mimeType, extension };
  }

  const extension = imageExtension(url, mimeType);
  if (!mimeType.startsWith("image/") || !extension) {
    throw new RemoteMediaError("앨범아트는 JPG, PNG, WEBP만 지원합니다.", 415);
  }
  return { mimeType, extension };
}

export function parseSingleByteRange(value: string | null) {
  if (!value) return null;
  return /^bytes=(?:\d+-\d*|-\d+)$/.test(value.trim()) ? value.trim() : null;
}

export function remoteResponseTotalBytes(response: Response) {
  const contentRange = response.headers.get("content-range");
  const match = contentRange?.match(/\/([0-9]+)$/);
  if (match) {
    const total = Number(match[1]);
    return Number.isFinite(total) && total >= 0 ? total : null;
  }

  if (response.status === 200) {
    const length = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(length) && length > 0 ? length : null;
  }
  return null;
}

export function remoteFilename(url: URL, fallback: string) {
  let raw = fallback;
  try {
    raw = decodeURIComponent(url.pathname.split("/").pop() || fallback);
  } catch {
    raw = url.pathname.split("/").pop() || fallback;
  }
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return safe || fallback;
}

export async function fetchRemoteMedia(rawUrl: string, options: FetchRemoteOptions) {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new RemoteMediaError("미디어 URL이 올바르지 않습니다.", 400);
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttps(current);
    const headers: Record<string, string> = {
      Accept:
        options.kind === "audio"
          ? "audio/*,application/octet-stream;q=0.8,*/*;q=0.1"
          : "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.1",
      "User-Agent": options.userAgent ?? "MusicTube/0.1 remote-media",
    };
    if (options.range) headers.Range = options.range;

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "원격 미디어 요청에 실패했습니다.";
      throw new RemoteMediaError(message, 502);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new RemoteMediaError("원격 미디어가 잘못된 리다이렉트를 반환했습니다.", 502);
      current = new URL(location, current);
      continue;
    }

    const validation = validateKind(current, response, options.kind);
    return { response, finalUrl: current, ...validation };
  }

  throw new RemoteMediaError("원격 미디어 리다이렉트 횟수가 너무 많습니다.", 502);
}

async function streamResponseToFile(input: {
  response: Response;
  path: string;
  maxBytes: number;
  tooLargeMessage: string;
}) {
  const { response, path, maxBytes, tooLargeMessage } = input;
  const announced = remoteResponseTotalBytes(response) ?? Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RemoteMediaError(tooLargeMessage, 413);
  }
  if (!response.body) throw new RemoteMediaError("원격 미디어 본문이 비어 있습니다.", 502);

  const handle = await open(path, "wx");
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("MusicTube remote media limit exceeded").catch(() => undefined);
        throw new RemoteMediaError(tooLargeMessage, 413);
      }
      await handle.write(value);
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
    reader.releaseLock();
  }

  if (bytes <= 0) {
    await rm(path, { force: true }).catch(() => undefined);
    throw new RemoteMediaError("원격 미디어 파일이 비어 있습니다.", 502);
  }
  return bytes;
}

export async function downloadRemoteAudio(rawUrl: string, directory: string) {
  const remote = await fetchRemoteMedia(rawUrl, {
    kind: "audio",
    userAgent: "MusicTube/0.1 render-audio",
  });
  const filename = `audio${remote.extension}`;
  const path = join(directory, filename);
  const bytes = await streamResponseToFile({
    response: remote.response,
    path,
    maxBytes: MAX_REMOTE_AUDIO_BYTES,
    tooLargeMessage: "음원 파일은 최대 160 MB까지 지원합니다.",
  });
  return { filename, bytes, finalUrl: remote.finalUrl };
}

export async function downloadRemoteImage(rawUrl: string, directory: string) {
  const remote = await fetchRemoteMedia(rawUrl, {
    kind: "image",
    userAgent: "MusicTube/0.1 render-cover",
  });
  const filename = `cover${remote.extension}`;
  const path = join(directory, filename);
  const bytes = await streamResponseToFile({
    response: remote.response,
    path,
    maxBytes: MAX_REMOTE_IMAGE_BYTES,
    tooLargeMessage: "앨범아트는 최대 20 MB까지 지원합니다.",
  });
  return { filename, bytes, finalUrl: remote.finalUrl };
}
