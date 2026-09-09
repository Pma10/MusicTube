import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 160 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"];

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(value: string) {
  const ip = value.toLowerCase().split("%")[0];
  return (
    ip === "::" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb") ||
    ip.startsWith("::ffff:127.") ||
    ip.startsWith("::ffff:10.") ||
    ip.startsWith("::ffff:192.168.")
  );
}

function isPrivateAddress(value: string) {
  const family = isIP(value);
  if (family === 4) return isPrivateIpv4(value);
  if (family === 6) return isPrivateIpv6(value);
  return true;
}

async function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new Error("HTTPS audio URLs only");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Local addresses are not allowed");

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private network addresses are not allowed");
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("The audio host resolves to a private network address");
  }
}

async function safeFetch(initialUrl: URL) {
  let current = initialUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHttps(current);
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "audio/*,application/octet-stream;q=0.8,*/*;q=0.1",
        "User-Agent": "MusicTube/0.1 remote-audio-import",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Audio source returned an invalid redirect");
      current = new URL(location, current);
      continue;
    }

    return { response, finalUrl: current };
  }

  throw new Error("Too many redirects");
}

function looksLikeAudio(url: URL, contentType: string) {
  if (contentType.toLowerCase().startsWith("audio/")) return true;
  if (contentType.toLowerCase().startsWith("application/octet-stream")) {
    return AUDIO_EXTENSIONS.some((extension) => url.pathname.toLowerCase().endsWith(extension));
  }
  return AUDIO_EXTENSIONS.some((extension) => url.pathname.toLowerCase().endsWith(extension));
}

function filenameFromUrl(url: URL) {
  const raw = decodeURIComponent(url.pathname.split("/").pop() || "remote-audio");
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
  return safe || "remote-audio";
}

function limitStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let total = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel("Audio file exceeded MusicTube import limit");
          controller.error(new Error("Audio file is larger than 160 MB"));
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!rawUrl) return NextResponse.json({ error: "url is required" }, { status: 400 });

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid audio URL" }, { status: 400 });
  }

  try {
    const { response, finalUrl } = await safeFetch(sourceUrl);
    if (!response.ok) {
      return NextResponse.json({ error: `Audio source returned HTTP ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
    if (!looksLikeAudio(finalUrl, contentType)) {
      return NextResponse.json({ error: "The URL did not return an audio file" }, { status: 415 });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Audio file is larger than 160 MB" }, { status: 413 });
    }

    if (!response.body) return NextResponse.json({ error: "Audio source returned an empty body" }, { status: 502 });

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filenameFromUrl(finalUrl))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (contentLength > 0) headers.set("Content-Length", String(contentLength));

    return new NextResponse(limitStream(response.body), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import audio";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
