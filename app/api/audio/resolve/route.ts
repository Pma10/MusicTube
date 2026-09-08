import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ResolverPayload = {
  url?: string;
  filename?: string;
};

export async function GET(request: NextRequest) {
  const resolverUrl = process.env.MUSICTUBE_AUDIO_RESOLVER_URL?.trim();
  if (!resolverUrl) return new NextResponse(null, { status: 204 });

  const provider = request.nextUrl.searchParams.get("provider")?.trim() || "genie";
  const songId = request.nextUrl.searchParams.get("songId")?.trim() || "";
  const title = request.nextUrl.searchParams.get("title")?.trim() || "";
  const artist = request.nextUrl.searchParams.get("artist")?.trim() || "";

  try {
    const target = new URL(resolverUrl);
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
      return NextResponse.json({ error: "Audio resolver must use HTTPS" }, { status: 500 });
    }

    target.searchParams.set("provider", provider);
    target.searchParams.set("songId", songId);
    target.searchParams.set("title", title);
    target.searchParams.set("artist", artist);

    const response = await fetch(target, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (response.status === 404 || response.status === 204) return new NextResponse(null, { status: 204 });
    if (!response.ok) {
      return NextResponse.json({ error: `Audio resolver returned HTTP ${response.status}` }, { status: 502 });
    }

    const payload = (await response.json()) as ResolverPayload;
    if (!payload.url) return new NextResponse(null, { status: 204 });

    let audioUrl: URL;
    try {
      audioUrl = new URL(payload.url);
    } catch {
      return NextResponse.json({ error: "Audio resolver returned an invalid URL" }, { status: 502 });
    }

    if (audioUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Audio resolver must return an HTTPS URL" }, { status: 502 });
    }

    return NextResponse.json({ url: audioUrl.toString(), filename: payload.filename || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio resolver failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
