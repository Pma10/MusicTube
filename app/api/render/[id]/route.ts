import { NextResponse } from "next/server";
import { cancelRenderJob, getRenderJob } from "@/lib/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const job = await getRenderJob(id);
  if (!job) return NextResponse.json({ error: "렌더 작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const job = await getRenderJob(id);
  if (!job) return NextResponse.json({ error: "렌더 작업을 찾을 수 없습니다." }, { status: 404 });

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ error: "이미 종료된 렌더 작업입니다." }, { status: 409 });
  }

  const cancelled = await cancelRenderJob(id);
  return NextResponse.json({ id, status: cancelled ? "cancelled" : job.status });
}
