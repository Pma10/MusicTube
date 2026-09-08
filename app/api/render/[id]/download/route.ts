import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { cleanupRenderJob, getRenderJobFile } from "@/lib/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const file = await getRenderJobFile(id);
  if (!file) {
    return NextResponse.json({ error: "완료된 렌더 결과를 찾을 수 없습니다." }, { status: 404 });
  }

  const nodeStream = createReadStream(file.path);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  nodeStream.once("close", () => {
    void cleanupRenderJob(id);
  });

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
