import { NextRequest, NextResponse } from "next/server";
import {
  fetchRemoteMedia,
  MAX_REMOTE_AUDIO_BYTES,
  parseSingleByteRange,
  RemoteMediaError,
  remoteFilename,
  remoteResponseTotalBytes,
} from "@/lib/remote-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        if (total > MAX_REMOTE_AUDIO_BYTES) {
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

function sourceUrl(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!rawUrl) throw new RemoteMediaError("url is required", 400);
  return rawUrl;
}

function sizeHeaders(response: Response) {
  const total = remoteResponseTotalBytes(response);
  if (total !== null && total > MAX_REMOTE_AUDIO_BYTES) {
    throw new RemoteMediaError("Audio file is larger than 160 MB", 413);
  }

  const chunkLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(chunkLength) && chunkLength > MAX_REMOTE_AUDIO_BYTES) {
    throw new RemoteMediaError("Audio file is larger than 160 MB", 413);
  }
  return { total, chunkLength: Number.isFinite(chunkLength) && chunkLength > 0 ? chunkLength : null };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to import audio";
  const status = error instanceof RemoteMediaError ? error.status : 502;
  return NextResponse.json({ error: message }, { status });
}

export async function HEAD(request: NextRequest) {
  try {
    const remote = await fetchRemoteMedia(sourceUrl(request), {
      kind: "audio",
      range: "bytes=0-0",
      userAgent: "MusicTube/0.1 remote-audio-probe",
    });
    const { total } = sizeHeaders(remote.response);
    await remote.response.body?.cancel().catch(() => undefined);

    const headers = new Headers({
      "Content-Type": remote.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-MusicTube-Filename": remoteFilename(remote.finalUrl, `remote-audio${remote.extension}`),
      "Accept-Ranges": "bytes",
    });
    if (total !== null) headers.set("X-MusicTube-Bytes", String(total));

    return new NextResponse(null, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const requestedRange = request.headers.get("range");
  const range = parseSingleByteRange(requestedRange);
  if (requestedRange && !range) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Cache-Control": "private, no-store", "Accept-Ranges": "bytes" },
    });
  }

  try {
    const remote = await fetchRemoteMedia(sourceUrl(request), {
      kind: "audio",
      range,
      userAgent: "MusicTube/0.1 remote-audio-stream",
    });
    const { chunkLength } = sizeHeaders(remote.response);

    if (!remote.response.body) {
      return NextResponse.json({ error: "Audio source returned an empty body" }, { status: 502 });
    }

    const status = remote.response.status === 206 ? 206 : 200;
    const headers = new Headers({
      "Content-Type": remote.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(remoteFilename(remote.finalUrl, `remote-audio${remote.extension}`))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "X-MusicTube-Filename": remoteFilename(remote.finalUrl, `remote-audio${remote.extension}`),
    });
    if (chunkLength !== null) headers.set("Content-Length", String(chunkLength));
    const contentRange = remote.response.headers.get("content-range");
    if (status === 206 && contentRange) headers.set("Content-Range", contentRange);

    return new NextResponse(limitStream(remote.response.body), { status, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
