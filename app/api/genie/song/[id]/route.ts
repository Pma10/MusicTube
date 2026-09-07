const GENIE_API_URL = process.env.GENIE_API_URL ?? "http://127.0.0.1:8765";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!/^\d+$/.test(id)) {
    return Response.json({ error: "잘못된 Genie 곡 ID입니다." }, { status: 400 });
  }

  try {
    const response = await fetch(new URL(`/songs/${id}`, GENIE_API_URL), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return Response.json(
        { error: payload?.detail ?? "곡 정보를 불러오지 못했습니다." },
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
