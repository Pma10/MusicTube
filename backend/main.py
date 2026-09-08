from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from genieapi import GenieAPI

app = FastAPI(title="MusicTube Genie bridge", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

genie = GenieAPI()


def _normalize_image_url(value: str | None) -> str:
    if not value:
        return ""

    url = value.strip()
    if url.startswith("https:https://"):
        url = url.replace("https:https://", "https://", 1)
    elif url.startswith("https:https:"):
        url = url.replace("https:https:", "https:", 1)
    elif url.startswith("//"):
        url = f"https:{url}"

    return url


def _song_payload(song: Any) -> dict[str, Any]:
    data = asdict(song)
    data["thumbnail_url"] = _normalize_image_url(data.get("thumbnail_url"))
    return data


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "Pma10/GenieAPI"}


@app.get("/search")
def search(q: str = Query(min_length=1, max_length=100), limit: int = Query(default=8, ge=1, le=20)) -> dict[str, Any]:
    try:
        songs = genie.search_song(q.strip(), limit=limit)
        return {"songs": [_song_payload(song) for song in songs]}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Genie search failed: {exc}") from exc


@app.get("/songs/{song_id}")
def song(song_id: str) -> dict[str, Any]:
    if not song_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid Genie song id")

    try:
        detail = genie.get_song_detail(song_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="Song not found")

        lyric = genie.get_lyrics(song_id)
        return {
            "song": _song_payload(detail),
            "lrc": lyric.to_lrc(),
            "source": {
                "provider": "Genie",
                "song_id": song_id,
                "url": detail.url,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Genie song lookup failed: {exc}") from exc
