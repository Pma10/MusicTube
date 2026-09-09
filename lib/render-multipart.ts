import { open, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import Busboy from "busboy";

export const MAX_RENDER_AUDIO_BYTES = 160 * 1024 * 1024;
export const MAX_RENDER_COVER_BYTES = 20 * 1024 * 1024;

const MAX_FIELD_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_RENDER_AUDIO_BYTES + MAX_RENDER_COVER_BYTES + 2 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
const COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ACCEPTED_FIELDS = new Set([
  "title",
  "artist",
  "lyrics",
  "duration",
  "motionPreset",
  "motionIntensity",
  "theme",
  "resolution",
  "renderProfile",
  "coverUrl",
  "audioUrl",
]);

type UploadFileInfo = {
  filename: string;
  mimeType: string;
};

type UploadFileStream = Readable & {
  truncated?: boolean;
};

export class RenderMultipartError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RenderMultipartError";
  }
}

type StoredPart = {
  filename: string;
  bytes: number;
};

type StoredParts = {
  audio: StoredPart | null;
  cover: StoredPart | null;
};

export type ParsedRenderMultipart = {
  fields: Record<string, string>;
  audio: StoredPart | null;
  cover: StoredPart | null;
};

function audioExtension(filename: string, mimeType: string) {
  const extension = extname(filename).toLowerCase();
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

function coverExtension(filename: string, mimeType: string) {
  const extension = extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  return COVER_EXTENSIONS.has(extension) ? (extension === ".jpeg" ? ".jpg" : extension) : null;
}

function asBuffer(chunk: unknown) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Buffer.from(String(chunk));
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, data: Buffer) {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("첨부 파일 쓰기가 중단되었습니다.");
    offset += bytesWritten;
  }
}

async function storeFilePart(
  stream: UploadFileStream,
  path: string,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<number> {
  const handle = await open(path, "wx");
  let bytes = 0;
  let exceeded = false;

  try {
    for await (const chunk of stream) {
      const data = asBuffer(chunk);
      bytes += data.byteLength;
      if (bytes > maxBytes) {
        exceeded = true;
        continue;
      }
      await writeAll(handle, data);
    }
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }

  if (stream.truncated === true || exceeded) {
    await rm(path, { force: true }).catch(() => undefined);
    throw new RenderMultipartError(tooLargeMessage, 413);
  }

  return bytes;
}

function validateAudio(info: UploadFileInfo) {
  const extension = audioExtension(info.filename, info.mimeType);
  const looksLikeAudio = info.mimeType.toLowerCase().startsWith("audio/") || extension !== null;
  if (!looksLikeAudio || !extension) {
    throw new RenderMultipartError(
      "지원하는 음원 형식이 아닙니다. MP3, WAV, M4A, AAC, FLAC, OGG, OPUS를 사용해 주세요.",
      415,
    );
  }
  return extension;
}

function validateCover(info: UploadFileInfo) {
  const extension = coverExtension(info.filename, info.mimeType);
  if (!info.mimeType.toLowerCase().startsWith("image/") || !extension) {
    throw new RenderMultipartError("앨범아트는 JPG, PNG, WEBP만 지원합니다.", 415);
  }
  return extension;
}

export async function parseRenderMultipart(request: Request, publicDir: string): Promise<ParsedRenderMultipart> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new RenderMultipartError("multipart/form-data 요청이 필요합니다.", 415);
  }
  if (!request.body) {
    throw new RenderMultipartError("렌더 요청 본문이 비어 있습니다.", 400);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RenderMultipartError("렌더 요청이 허용된 최대 크기를 초과했습니다.", 413);
  }

  const fields: Record<string, string> = {};
  const stored: StoredParts = { audio: null, cover: null };
  let sawAudio = false;
  let sawCover = false;
  let fatalError: Error | null = null;
  const writes: Promise<void>[] = [];

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 2,
        fields: 20,
        parts: 24,
        fieldNameSize: 80,
        fieldSize: MAX_FIELD_BYTES,
        fileSize: MAX_RENDER_AUDIO_BYTES + 1,
      },
    });
  } catch {
    throw new RenderMultipartError("multipart/form-data 형식이 올바르지 않습니다.", 400);
  }

  const setFatal = (error: Error) => {
    fatalError ??= error;
  };

  parser.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated) {
      setFatal(new RenderMultipartError("렌더 설정 필드가 너무 큽니다.", 413));
      return;
    }
    if (ACCEPTED_FIELDS.has(name)) fields[name] = value;
  });

  parser.on("file", (name, stream, info) => {
    if (name !== "audio" && name !== "cover") {
      stream.resume();
      return;
    }

    try {
      if (name === "audio") {
        if (sawAudio) {
          stream.resume();
          setFatal(new RenderMultipartError("음원 파일은 하나만 첨부할 수 있습니다.", 400));
          return;
        }
        sawAudio = true;
        const extension = validateAudio(info);
        const filename = `audio${extension}`;
        const path = join(publicDir, filename);
        writes.push(
          storeFilePart(stream, path, MAX_RENDER_AUDIO_BYTES, "음원 파일은 최대 160 MB까지 지원합니다.")
            .then((bytes) => {
              stored.audio = { filename, bytes };
            })
            .catch((error: unknown) => {
              setFatal(error instanceof Error ? error : new Error("음원을 저장하지 못했습니다."));
            }),
        );
        return;
      }

      if (sawCover) {
        stream.resume();
        setFatal(new RenderMultipartError("앨범아트는 하나만 첨부할 수 있습니다.", 400));
        return;
      }
      sawCover = true;
      const extension = validateCover(info);
      const filename = `cover${extension}`;
      const path = join(publicDir, filename);
      writes.push(
        storeFilePart(stream, path, MAX_RENDER_COVER_BYTES, "앨범아트는 최대 20 MB까지 지원합니다.")
          .then((bytes) => {
            stored.cover = { filename, bytes };
          })
          .catch((error: unknown) => {
            setFatal(error instanceof Error ? error : new Error("앨범아트를 저장하지 못했습니다."));
          }),
      );
    } catch (error) {
      stream.resume();
      setFatal(error instanceof Error ? error : new Error("첨부 파일을 처리하지 못했습니다."));
    }
  });

  parser.on("filesLimit", () => setFatal(new RenderMultipartError("첨부 파일 수가 너무 많습니다.", 413)));
  parser.on("fieldsLimit", () => setFatal(new RenderMultipartError("렌더 설정 필드 수가 너무 많습니다.", 413)));
  parser.on("partsLimit", () => setFatal(new RenderMultipartError("multipart 항목 수가 너무 많습니다.", 413)));

  let receivedBytes = 0;
  const totalLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      const data = asBuffer(chunk);
      receivedBytes += data.byteLength;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        callback(new RenderMultipartError("렌더 요청이 허용된 최대 크기를 초과했습니다.", 413));
        return;
      }
      callback(null, data);
    },
  });

  const source = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>);
  try {
    await pipeline(source, totalLimiter, parser);
  } catch (error) {
    await Promise.allSettled(writes);
    if (error instanceof RenderMultipartError) throw error;
    if (fatalError) throw fatalError;
    throw new RenderMultipartError("multipart/form-data 요청을 끝까지 읽지 못했습니다.", 400);
  }

  await Promise.all(writes);

  if (fatalError) throw fatalError;
  const audio = stored.audio;
  const cover = stored.cover;
  if (audio?.bytes === 0) throw new RenderMultipartError("음원 파일이 비어 있습니다.", 400);
  if (cover?.bytes === 0) throw new RenderMultipartError("앨범아트 파일이 비어 있습니다.", 400);
  if (!audio && !fields.audioUrl?.trim()) {
    throw new RenderMultipartError("영상 생성에는 음원 파일 또는 음원 URL이 필요합니다.", 400);
  }

  return { fields, audio, cover };
}
