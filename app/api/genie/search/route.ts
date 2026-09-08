const GENIE_API_URL = process.env.GENIE_API_URL ?? "http://127.0.0.1:8765";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const limit = url.searchParams.get("limit") ?? "8";

  if (!query) {
    return Response.json({ error: "검색어를 입력해주세요." }, { status: 400 });
  }

  try {
    const upstream = new URL("/search", GENIE_API_URL);
    upstream.searchParams.set("q", query);
    upstream.searchParams.set("limit", limit);

    const response = await fetch(upstream, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return Response.json(
        { error: payload?.detail ?? "Genie 검색에 실패했습니다." },
        { status: response.status },
      );
    }

    return Response.json(payload);
  } catch {
    return Response.json(
      { error: "GenieAPI 서비스에 연결할 수 없습니다." },
      { status: 502 },
    );
  }
}
