import { searchGenieSongs } from "@/lib/genie";

function getSearchErrorMessage(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : "";

  if (
    error instanceof TypeError ||
    ["EACCES", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code)
  ) {
    return "검색 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.";
  }

  return "검색에 실패했습니다. 잠시 후 다시 시도해주세요.";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(20, rawLimit)) : 8;

  if (!query) {
    return Response.json({ error: "검색어를 입력해주세요." }, { status: 400 });
  }

  try {
    const songs = await searchGenieSongs(query, limit);
    return Response.json({ songs });
  } catch (error) {
    console.error("[Genie] search failed", error);
    return Response.json(
      { error: getSearchErrorMessage(error) },
      { status: 502 },
    );
  }
}
