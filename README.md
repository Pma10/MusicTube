# MusicTube

MusicTube is a small studio for building polished, YouTube-ready music visuals from album artwork, audio and synced lyrics.

## Current MVP

- 16:9 music-player inspired video preview
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

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Next milestone

The editor/preview layer is intentionally separated from the final renderer. The next step is to add a render composition and server-side FFmpeg/Remotion pipeline for H.264 + AAC MP4 export at 1080p/1440p/4K.
