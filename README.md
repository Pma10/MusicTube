# MusicTube

MusicTube is a small studio for building polished, YouTube-ready music visuals from album artwork, audio and synced lyrics.

## Current MVP

- 16:9 music-player inspired video preview
- Genie song search powered by `Pma10/GenieAPI`
- One-click title, artist, album-art and timestamped lyric import from Genie
- Optional automatic audio lookup through a configured audio resolver
- Direct HTTPS audio URL import with SSRF/private-network protection and a 160 MB limit
- Audio file attachment + drag-and-drop with real playback, seeking and duration sync
- Album-art attachment with blurred ambient background
- LRC file attachment and timestamp parsing (`[mm:ss.xx]`)
- Smooth lyric cross-fade / slide / blur transitions
- Soft, Cinema and Minimal motion presets
- Warm, Cool and Mono visual themes
- Subtle Ken Burns background/cover motion while playing
- Editable title, artist and channel text
- One-click server-side MP4 rendering with Remotion
- 1080p, 1440p and 4K H.264 + AAC output at 60 FPS
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

## MP4 rendering

The Export section sends the selected audio, cover art, metadata, LRC lyrics and motion settings to `/api/render`. The Node.js route creates a temporary Remotion bundle, renders the `MusicTubeVideo` composition, encodes H.264 video with AAC audio and streams the finished MP4 back to the browser.

Available output sizes:

- `1080p` — 1920×1080
- `1440p` — 2560×1440
- `4K` — 3840×2160

All presets render at 60 FPS. Each render gets an isolated directory under the operating system temp folder; uploaded audio/artwork, the encoded MP4 and render assets are removed after rendering/download cleanup. Remotion may download its headless Chrome build the first time rendering is used, so the first export can take longer than later exports.

Rendering is intended for a normal Node.js host/VPS/container with enough CPU, RAM and temporary disk space. Long 4K/60 FPS videos are compute-heavy and are not a good fit for short-lived serverless request limits.

## Audio sources

GenieAPI is used for metadata, artwork and synced lyrics. MusicTube does not scrape or bypass a streaming service to obtain protected full-track audio. Instead the editor supports three audio paths:

1. **Automatic resolver** — set `MUSICTUBE_AUDIO_RESOLVER_URL` to an audio library/service you control or are licensed to use. After a Genie result is selected, MusicTube sends `provider`, `songId`, `title`, and `artist` as query parameters. Return JSON in this shape:

```json
{"url":"https://cdn.example.com/audio/song.mp3","filename":"song.mp3"}
```

2. **Direct audio URL** — paste a direct HTTPS URL to an audio file. `/api/media/import` validates the destination, blocks private/local network targets, follows a small number of validated redirects, checks the response is audio-like, and limits imports to 160 MB.

3. **Attachment** — attach or drag an MP3, WAV, M4A, AAC, FLAC, OGG, or OPUS file directly into the editor. You can also attach an `.lrc` file separately.

Only use audio you have the rights or permission to use and publish.

> GenieAPI is an unofficial wrapper around genie.co.kr and depends on the current Genie page/data format. Use it conservatively and expect upstream site changes to occasionally require parser updates.
