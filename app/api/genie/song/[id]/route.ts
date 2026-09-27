import { genieSongUrl, getGenieLyrics, getGenieSongDetail } from "@/lib/genie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!/^\d+$/.test(id)) {
    return Response.json({ error: "잘못된 곡 ID입니다." }, { status: 400 });
  }

  try {
    const detail = await getGenieSongDetail(id);
    if (!detail) {
      return Response.json({ error: "곡 정보를 찾지 못했습니다." }, { status: 404 });
    }

    let lrc = "";
    try {
      lrc = await getGenieLyrics(id);
    } catch (error) {
      console.warn(`[Genie] lyrics unavailable for ${id}`, error);
    }

    return Response.json({
      song: detail,
      lrc,
      source: {
        provider: "Genie",
        song_id: id,
        url: genieSongUrl(id),
      },
    });
  } catch (error) {
    console.error(`[Genie] song lookup failed for ${id}`, error);
    return Response.json(
      { error: "곡 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }
}
