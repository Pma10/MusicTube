import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getRenderJobFile } from "@/lib/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type ByteRange = { start: number; end: number };
type RenderFile = { filename: string; size: number; path: string };

function parseRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return "invalid";

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return "invalid";

  if (!startRaw) {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    const length = Math.min(size, suffix);
    return { start: size - length, end: size - 1 };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size) {
    return "invalid";
  }

  const end = Math.min(size - 1, requestedEnd);
  if (end < start) return "invalid";
  return { start, end };
}

function fileEtag(id: string, file: RenderFile) {
  return `"musictube-${id}-${file.size}"`;
}

function commonHeaders(id: string, file: RenderFile) {
  return {
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: fileEtag(id, file),
  };
}

async function resolveFile(context: Context) {
  const { id } = await context.params;
  const file = await getRenderJobFile(id);
  return { id, file };
}

export async function HEAD(_request: Request, context: Context) {
  const { id, file } = await resolveFile(context);
  if (!file) {
    return NextResponse.json({ error: "완료된 렌더 결과를 찾을 수 없습니다." }, { status: 404 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      ...commonHeaders(id, file),
      "Content-Length": String(file.size),
    },
  });
}

export async function GET(request: Request, context: Context) {
  const { id, file } = await resolveFile(context);
  if (!file) {
    return NextResponse.json({ error: "완료된 렌더 결과를 찾을 수 없습니다." }, { status: 404 });
  }

  const etag = fileEtag(id, file);
  const requestedRange = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const rangeHeader = requestedRange && (!ifRange || ifRange === etag) ? requestedRange : null;
  const range = parseRange(rangeHeader, file.size);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...commonHeaders(id, file),
        "Content-Range": `bytes */${file.size}`,
      },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const length = end - start + 1;
  const nodeStream = createReadStream(file.path, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: range ? 206 : 200,
    headers: {
      ...commonHeaders(id, file),
      "Content-Length": String(length),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
    },
  });
}
