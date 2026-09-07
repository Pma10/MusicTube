# MusicTube

MusicTube is a small studio for building polished, YouTube-ready music visuals from album artwork, audio and synced lyrics.

## Current MVP

- 16:9 music-player inspired video preview
- Genie song search powered by `Pma10/GenieAPI`
- One-click title, artist, album-art and timestamped lyric import from Genie
- Album-art upload with blurred ambient background
- Audio upload with real playback, seeking and duration sync
- LRC timestamp parsing (`[mm:ss.xx]`)
- Smooth lyric cross-fade / slide / blur transitions
- Soft, Cinema and Minimal motion presets
- Warm, Cool and Mono visual themes
- Subtle Ken Burns background/cover motion while playing
- Editable title, artist and channel text
- Project configuration export as `.musictube.json`
- Responsive editor UI and reduced-motion accessibility

## Run locally

MusicTube uses a tiny FastAPI bridge around the Python GenieAPI package. Start it first:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload
```

Then start the editor in another terminal:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Search results are proxied through the Next.js `/api/genie/*` routes, so the browser never talks to the scraper service directly.

`GENIE_API_URL` can point at a separately deployed Genie bridge in production. The dependency is pinned to a known `Pma10/GenieAPI` commit for reproducible installs.

> GenieAPI is an unofficial wrapper around genie.co.kr and depends on the current Genie page/data format. Use it conservatively and expect upstream site changes to occasionally require parser updates.

## Next milestone

The editor/preview layer is intentionally separated from the final renderer. The next step is to add a render composition and server-side FFmpeg/Remotion pipeline for H.264 + AAC MP4 export at 1080p/1440p/4K.
