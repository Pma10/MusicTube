"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Music2, Sparkles, Upload } from "lucide-react";
import { parseLyrics } from "@/lib/lrc";
import { GenieSearch, type GenieSelection } from "@/components/GenieSearch";
import {
  VideoPreview,
  type MotionPreset,
  type ThemePreset,
} from "@/components/VideoPreview";

const SAMPLE_LYRICS = `[00:02.00]오래된 장면 끝에 멈춰 선 밤
[00:06.20]낯익은 공기가 천천히 번지고
[00:10.40]희미했던 마음이 다시 선명해져
[00:14.60]우리는 그때의 온도를 기억해`;

function durationToSeconds(value?: string | null) {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function MusicEditor() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const coverObjectUrlRef = useRef<string | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const [title, setTitle] = useState("Nostalgia");
  const [artist, setArtist] = useState("BIG Naughty");
  const [channel, setChannel] = useState("1H KPOP");
  const [lyricsText, setLyricsText] = useState(SAMPLE_LYRICS);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [genieSongId, setGenieSongId] = useState<string | null>(null);
  const [duration, setDuration] = useState(180);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("soft");
  const [motionIntensity, setMotionIntensity] = useState(1);
  const [theme, setTheme] = useState<ThemePreset>("warm");
  const lyrics = useMemo(() => parseLyrics(lyricsText), [lyricsText]);

  useEffect(() => {
    if (audioUrl || !isPlaying) return;

    const timer = window.setInterval(() => {
      setCurrentTime((value) => {
        if (value >= duration) return 0;
        return Math.min(duration, value + 0.1);
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [audioUrl, duration, isPlaying]);

  useEffect(() => {
    return () => {
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    };
  }, []);

  const loadCover = (file?: File) => {
    if (!file) return;
    if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    coverObjectUrlRef.current = nextUrl;
    setCoverUrl(nextUrl);
    setCoverName(file.name);
    setGenieSongId(null);
  };

  const loadAudio = (file?: File) => {
    if (!file) return;
    audioRef.current?.pause();
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    audioObjectUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
    setAudioName(file.name);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const applyGenieSelection = (selection: GenieSelection) => {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = null;
    }

    setTitle(selection.song.title || title);
    setArtist(selection.song.artist || artist);
    setGenieSongId(selection.source.song_id);

    if (selection.song.thumbnail_url) {
      setCoverUrl(selection.song.thumbnail_url);
      setCoverName(`Genie · ${selection.song.album || selection.song.title}`);
    }

    if (selection.lrc.trim()) setLyricsText(selection.lrc);

    const genieDuration = durationToSeconds(selection.song.duration);
    if (genieDuration && !audioUrl) {
      setDuration(genieDuration);
      setCurrentTime(0);
    }
  };

  const togglePlay = async () => {
    if (!audioUrl || !audioRef.current) {
      setIsPlaying((value) => !value);
      return;
    }

    if (audioRef.current.paused) {
      await audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  };

  const seek = (value: number) => {
    const safe = Math.max(0, Math.min(duration, value));
    setCurrentTime(safe);
    if (audioRef.current) audioRef.current.currentTime = safe;
  };

  const exportProject = () => {
    const project = {
      version: 1,
      metadata: { title, artist, channel },
      lyrics: lyricsText,
      appearance: { theme, motionPreset, motionIntensity },
      media: { audioName, coverName },
      source: genieSongId ? { provider: "Genie", songId: genieSongId } : null,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.trim() || "musictube-project"}.musictube.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <div className="eyebrow"><Sparkles size={14} /> MusicTube Studio</div>
          <h1>음악 영상 생성기</h1>
          <p>Genie에서 곡 정보를 불러오거나 직접 앨범아트, 음원, 가사를 넣어 부드러운 전환을 미리보세요.</p>
        </div>
        <div className="header-actions">
          <span className="status-pill"><span /> Preview ready</span>
          <button className="secondary-button" type="button" onClick={exportProject}>
            <Download size={16} /> 프로젝트 저장
          </button>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="editor-panel">
          <section className="control-section">
            <div className="section-title">
              <span>01</span>
              <div><strong>Genie</strong><small>메타데이터 · 앨범아트 · 싱크 가사</small></div>
            </div>
            <GenieSearch onApply={applyGenieSelection} />
          </section>

          <section className="control-section">
            <div className="section-title">
              <span>02</span>
              <div><strong>Media</strong><small>영상에 사용할 파일</small></div>
            </div>

            <label className="upload-card">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadCover(event.target.files?.[0])} />
              <div className="upload-icon"><ImagePlus size={19} /></div>
              <div className="upload-copy">
                <strong>{coverName ?? "앨범아트 업로드"}</strong>
                <span>PNG, JPG, WEBP</span>
              </div>
              <Upload size={16} />
            </label>

            <label className="upload-card">
              <input type="file" accept="audio/*" onChange={(event) => loadAudio(event.target.files?.[0])} />
              <div className="upload-icon"><Music2 size={19} /></div>
              <div className="upload-copy">
                <strong>{audioName ?? "음원 업로드"}</strong>
                <span>MP3, WAV, M4A, FLAC*</span>
              </div>
              <Upload size={16} />
            </label>
          </section>

          <section className="control-section">
            <div className="section-title">
              <span>03</span>
              <div><strong>Metadata</strong><small>영상에 표시할 정보</small></div>
            </div>
            <label className="field-label">제목<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field-label">아티스트<input value={artist} onChange={(event) => setArtist(event.target.value)} /></label>
            <label className="field-label">채널 / 로고 텍스트<input value={channel} onChange={(event) => setChannel(event.target.value)} /></label>
          </section>

          <section className="control-section">
            <div className="section-title">
              <span>04</span>
              <div><strong>Lyrics</strong><small>LRC 타임코드 지원</small></div>
            </div>
            <textarea
              className="lyrics-editor"
              value={lyricsText}
              onChange={(event) => setLyricsText(event.target.value)}
              spellCheck={false}
              placeholder="[00:12.30]첫 번째 가사"
            />
            <div className="helper-row"><span>{lyrics.length} lines</span><span>{genieSongId ? `Genie #${genieSongId}` : "[mm:ss.xx] 형식"}</span></div>
          </section>

          <section className="control-section">
            <div className="section-title">
              <span>05</span>
              <div><strong>Motion</strong><small>전환 감도와 분위기</small></div>
            </div>
            <div className="segmented-control">
              {(["soft", "cinematic", "minimal"] as MotionPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={motionPreset === preset ? "active" : ""}
                  onClick={() => setMotionPreset(preset)}
                >
                  {preset === "soft" ? "Soft" : preset === "cinematic" ? "Cinema" : "Minimal"}
                </button>
              ))}
            </div>
            <label className="range-label">
              <div><span>애니메이션 강도</span><strong>{motionIntensity.toFixed(1)}×</strong></div>
              <input
                type="range"
                min="0.6"
                max="1.4"
                step="0.1"
                value={motionIntensity}
                onChange={(event) => setMotionIntensity(Number(event.target.value))}
              />
            </label>
            <div className="theme-grid">
              {(["warm", "cool", "mono"] as ThemePreset[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`theme-swatch theme-swatch--${item} ${theme === item ? "active" : ""}`}
                  onClick={() => setTheme(item)}
                  aria-label={`${item} theme`}
                ><span /></button>
              ))}
            </div>
          </section>
        </aside>

        <section className="preview-column">
          <div className="preview-toolbar">
            <div><strong>Preview</strong><span>1920 × 1080 · 16:9</span></div>
            <div className="preview-badges">
              {genieSongId ? <span>Genie synced</span> : null}
              <span>60 FPS motion</span>
              <span>LRC sync</span>
            </div>
          </div>

          <VideoPreview
            title={title}
            artist={artist}
            channel={channel}
            coverUrl={coverUrl}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            lyrics={lyrics}
            motionPreset={motionPreset}
            motionIntensity={motionIntensity}
            theme={theme}
            onTogglePlay={togglePlay}
            onSeek={seek}
          />

          <div className="render-note">
            <div><strong>실시간 프리뷰 완성</strong><span>GenieAPI 검색, 타임싱크 가사, 편집/모션 프리뷰와 프로젝트 저장을 지원합니다.</span></div>
            <span className="coming-pill">MP4 renderer · next</span>
          </div>
        </section>
      </div>

      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration;
            if (Number.isFinite(nextDuration)) setDuration(nextDuration);
          }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      ) : null}
    </main>
  );
}
