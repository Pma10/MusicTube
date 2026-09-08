# MusicTube

MusicTube is a local-first studio for building polished, YouTube-ready music visuals from album artwork, audio and synced lyrics.

## Features

- 16:9 music-player inspired live preview
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
- Local Remotion render queue with live progress and cancellation
- 1080p, 1440p and 4K H.264 + AAC MP4 output at 60 FPS
- Direct browser download without buffering the whole MP4 in page memory
- Project configuration export as `.musictube.json`
- Responsive editor UI and reduced-motion accessibility

## Local setup

Requirements: Node.js 22+, npm and Python 3.11+.

First-time setup:

```bash
npm run setup:local
```

This installs Node dependencies when needed, creates `.venv`, installs the Genie bridge dependencies and creates `.env.local` from `.env.example` without overwriting an existing file.

After that, start everything with one command:

```bash
npm run local
```

The launcher starts both services locally:

- MusicTube web UI: `http://127.0.0.1:3000`
- GenieAPI bridge: `http://127.0.0.1:8765`

It opens the browser automatically. Set `MUSICTUBE_OPEN=0` if you do not want auto-open. Press `Ctrl+C` to stop both processes.

You can still run the services manually if you prefer:

```bash
# terminal 1
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765

# terminal 2
npm run dev
```

On macOS/Linux use `.venv/bin/python` instead.

## MP4 rendering

The Export section submits the selected audio, cover art, metadata, LRC lyrics and motion settings to the local render queue. Jobs run sequentially so accidentally clicking render multiple times does not exhaust the machine.

Available output sizes:

- `1080p` — 1920×1080
- `1440p` — 2560×1440
- `4K` — 3840×2160

All presets render at 60 FPS to H.264 video with AAC audio. The UI polls real render progress, supports cancellation and exposes a direct download button when finished. The MP4 is streamed by the browser instead of first being converted into a giant in-page Blob, which is important for long videos.

Each job gets an isolated operating-system temp directory. Input assets are deleted as soon as rendering finishes; the completed MP4 is kept until download and is then cleaned up. Completed jobs also expire automatically if left unused.

Remotion may download its headless Chrome build the first time rendering is used, so the first export can take longer than later exports. 4K/60 FPS and hour-long videos are CPU, RAM and temporary-disk intensive, so 1080p is the practical default for long-form uploads.

## Audio sources

GenieAPI is used for metadata, artwork and synced lyrics. MusicTube does not scrape or bypass a streaming service to obtain protected full-track audio. Instead the editor supports three audio paths:

1. **Automatic resolver** — set `MUSICTUBE_AUDIO_RESOLVER_URL` to an audio library/service you control or are licensed to use. After a Genie result is selected, MusicTube sends `provider`, `songId`, `title`, and `artist` as query parameters. Return JSON in this shape:

```json
{"url":"https://cdn.example.com/audio/song.mp3","filename":"song.mp3"}
```

2. **Direct audio URL** — paste a direct HTTPS URL to an audio file. `/api/media/import` validates the destination, blocks private/local network targets, follows a small number of validated redirects, checks the response is audio-like, and limits imports to 160 MB.

3. **Attachment** — attach or drag an MP3, WAV, M4A, AAC, FLAC, OGG, or OPUS file directly into the editor. You can also attach an `.lrc` file separately.

Only use audio you have the rights or permission to use and publish.

> GenieAPI is an unofficial wrapper around genie.co.kr and depends on the current Genie page/data format. Upstream site changes may occasionally require parser updates.
