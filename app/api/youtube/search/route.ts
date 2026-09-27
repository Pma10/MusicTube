import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type YouTubeSearchResponse = {
  error?: { message?: string };
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (query.length < 2) {
    return NextResponse.json({ error: "두 글자 이상 입력해 주세요." }, { status: 400 });
  }

  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "YouTube 검색을 사용하려면 .env.local에 YOUTUBE_API_KEY를 설정해 주세요." },
      { status: 503 },
    );
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    key,
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    videoEmbeddable: "true",
    regionCode: "KR",
    relevanceLanguage: "ko",
    maxResults: "8",
    q: query,
  }).toString();

  try {
    const response = await fetch(url, { cache: "no-store", signal: request.signal });
    const payload = (await response.json()) as YouTubeSearchResponse;
    if (!response.ok) {
      const message = payload.error?.message || `YouTube API returned HTTP ${response.status}`;
      return NextResponse.json({ error: message }, { status: response.status === 403 ? 502 : 503 });
    }

    const videos = (payload.items ?? []).flatMap((item) => {
      const videoId = item.id?.videoId;
      const title = item.snippet?.title?.trim();
      if (!videoId || !title) return [];
      return [{
        videoId,
        title,
        artist: item.snippet?.channelTitle?.trim() || "YouTube Music",
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          null,
        musicUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      }];
    });

    return NextResponse.json({ videos }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    console.error("[YouTube] search request failed", error);
    const message = error instanceof TypeError
      ? "검색 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요."
      : "검색에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
