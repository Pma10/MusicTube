# MusicTube

MusicTube is a local-first studio for building polished, YouTube-ready music visuals from album artwork, audio and synced lyrics.

## Features

- 16:9 music-player inspired live preview
- Genie song search using a native Node.js port of the scraping/parsing logic from `Pma10/GenieAPI`
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
- Editable title and actual artist metadata; legacy fake channel/logo metadata has been removed
- Local Remotion render queue with stage-aware live progress, ETA and cancellation
- Fast 30 FPS and Quality 60 FPS render profiles
- Intel Quick Sync, NVIDIA NVENC and Apple VideoToolbox hardware encoding when available
- CPU-aware render concurrency instead of a fixed four-worker cap
- 1080p, 1440p and 4K H.264 + AAC MP4 output
- Streaming render uploads to disk instead of buffering large audio files in Node memory
- Temp-disk capacity preflight and stale render-directory cleanup
- Resumable HTTP Range downloads for large rendered MP4 files
- Versioned `.musictube.json` project save/load plus browser draft autosave
- Responsive editor UI and reduced-motion accessibility

## Local setup

Requirements: Node.js 22+ and npm. Python is not required.

First-time setup:

```bash
npm run setup:local
```

This installs Node dependencies when needed and creates `.env.local` from `.env.example` without overwriting an existing file. On Windows x64 it also prepares a local full FFmpeg build for Intel Quick Sync support. The downloaded binaries are stored under `.musictube/` and are not committed to Git.

After that, start the studio with one command:

```bash
npm run local
```

The launcher starts the MusicTube web UI at `http://127.0.0.1:3000`. Genie search, song detail parsing and timestamped lyrics are handled directly inside the Next.js Node runtime, so there is no FastAPI/uvicorn sidecar or Python virtual environment to keep running.

`npm run local` also verifies the Windows acceleration setup. The browser opens automatically. Set `MUSICTUBE_OPEN=0` if you do not want auto-open. Press `Ctrl+C` to stop the local studio.

You can also use the regular Next.js command:

```bash
npm run dev
```

## Genie integration

MusicTube contains a TypeScript/Node.js port of the parts of `Pma10/GenieAPI` it needs:

- `/search/searchMain` song search parsing
- `/detail/songInfo` song metadata parsing
- `dn.genie.co.kr/app/purchase/get_msl.asp` timestamped lyric parsing
- Genie image URL normalization and LRC conversion

The browser UI calls MusicTube's own `/api/genie/*` routes, and those routes contact Genie directly from the local Node.js process. Short-lived in-memory caches reduce duplicate scraper requests while typing/selecting songs.

If timed lyrics are unavailable for a track, metadata still loads and the editor can continue with an empty/manual LRC instead of failing the whole song lookup.

> This is still an unofficial Genie integration and depends on the current Genie page/data format. Upstream site changes may occasionally require parser updates.

## Project files and autosave

MusicTube project files are now versioned as schema version 2. The editor can both save and reopen `.musictube.json` files, and version 1 project files are migrated on load.

The project stores title, artist, lyrics, motion/theme settings, render profile/resolution, Genie source metadata, remembered direct HTTPS URLs, media filenames and duration. Local file bytes are intentionally not embedded in the JSON, so an attached audio file still needs to be reattached after reopening a project.

The browser also keeps a debounced local draft in `localStorage`. Reloading or accidentally closing the page restores the last project settings automatically without uploading anything anywhere.

## MP4 rendering

The Export section submits the selected audio, cover art, title, actual artist, LRC lyrics and motion settings to the local render queue. Jobs run sequentially so accidentally clicking render multiple times does not exhaust the machine.

Available output sizes:

- `1080p` — 1920×1080
- `1440p` — 2560×1440
- `4K` — 3840×2160

Render profiles:

- **Fast** — 30 FPS and the recommended default for long-form music uploads. When software encoding is required, x264 uses `veryfast`.
- **Quality** — 60 FPS and a higher target bitrate. When software encoding is required, x264 uses `medium`.

### Hardware encoder selection

MusicTube reports the actual encoder selected for every render job.

- **Windows:** NVIDIA NVENC → Intel Quick Sync (`h264_qsv`) → CPU x264
- **macOS:** Apple VideoToolbox → CPU fallback handled by Remotion when unavailable
- **Linux:** NVIDIA NVENC → CPU x264

Intel Quick Sync on Windows uses a full local FFmpeg build because Remotion's built-in Windows/Linux H.264 hardware path is NVENC-oriented. `npm run setup:local`, `npm run setup:accel`, or `npm run local` prepares the local FFmpeg directory and performs a real one-frame `h264_qsv` encode probe. If the probe fails, MusicTube safely falls back instead of reporting acceleration that does not work.

You can force a renderer with `MUSICTUBE_RENDER_ENCODER=auto|qsv|nvenc|x264`. A custom compatible FFmpeg/FFprobe/Remotion binary directory can be supplied with `MUSICTUBE_FFMPEG_BIN_DIR`.

Because hardware encoders do not use CRF in this path, MusicTube controls output quality with target video bitrates. Fast uses approximately 8/14/28 Mbps for 1080p/1440p/4K; Quality uses approximately 12/22/45 Mbps.

Render concurrency scales with the machine instead of being capped at four workers. Fast mode uses up to eight workers while leaving roughly one logical CPU free; Quality uses up to six workers. To override this manually, set `MUSICTUBE_RENDER_CONCURRENCY` to a value from 1 to 16.

Render requests use a streaming multipart parser. Attached audio and artwork are written incrementally into the job's temporary directory instead of calling `request.formData()` and materializing the whole audio file in Node memory. File, field and multipart-part limits are enforced while the upload is consumed.

Before a job is handed to Remotion, MusicTube estimates the expected MP4/workspace size from duration, resolution and the active bitrate profile and checks free space on the operating-system temp volume. If there is not enough headroom the request fails early with a clear storage error instead of rendering for a long time and dying near the end. Stale `musictube-render-*` directories older than 24 hours are also cleaned periodically so process restarts do not leave orphaned temp data forever.

The UI now separates renderer preparation, composition loading, frame rendering and MP4 finalization instead of showing a frozen `0%` while Remotion is bundling. It also exposes queue position and an approximate ETA once enough progress has accumulated.

Cancellation is race-safe: a running renderer receives Remotion's cancellation signal first and its temp directory is removed only after the renderer unwinds. Queued jobs can still be removed immediately. Invalid render settings also pass through the same cleanup path, so an already-streamed upload is not leaked when validation rejects the job.

Completed MP4 files are retained for roughly six hours and may be downloaded more than once. The download endpoint supports HTTP `Range` and `HEAD`, so browser retries/resume do not destroy the only copy. Accessing the completed file refreshes its retention window; expired jobs are removed automatically.

Each job gets an isolated operating-system temp directory. Input assets are deleted as soon as rendering finishes while the completed MP4 remains available during its retention window.

Remotion may download its headless Chrome build the first time rendering is used, so the first export can take longer than later exports. Hardware encoding speeds up H.264 compression, while React/Chromium frame generation still consumes CPU. Fast 1080p remains the practical default for long-form uploads.

## Lyric layout

The browser preview and final Remotion render use the same visual hierarchy: inactive surrounding lyrics are about 20 px at 1080p and the active lyric is about 26 px. The lyric region has a dedicated bounded middle row, so long or three-line lyric windows cannot overlap the playback controls. Before the first timestamp, the first lyric is highlighted as the upcoming line instead of rendering all lines as inactive gray text.

## Audio sources

Genie is used for metadata, artwork and synced lyrics. MusicTube does not scrape or bypass a streaming service to obtain protected full-track audio. Instead the editor supports three audio paths:

1. **Automatic resolver** — set `MUSICTUBE_AUDIO_RESOLVER_URL` to an audio library/service you control or are licensed to use. After a Genie result is selected, MusicTube sends `provider`, `songId`, `title`, and `artist` as query parameters. Return JSON in this shape:

```json
{"url":"https://cdn.example.com/audio/song.mp3","filename":"song.mp3"}
```

2. **Direct audio URL** — paste a direct HTTPS URL to an audio file. `/api/media/import` validates the destination, blocks private/local network targets, follows a small number of validated redirects, checks the response is audio-like, and limits imports to 160 MB. The proxy now streams the remote body through to the browser with an in-flight byte cap instead of constructing a second full in-memory copy on the server.

3. **Attachment** — attach or drag an MP3, WAV, M4A, AAC, FLAC, OGG, or OPUS file directly into the editor. You can also attach an `.lrc` file separately.

Only use audio you have the rights or permission to use and publish.
