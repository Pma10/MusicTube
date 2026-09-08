"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  Music2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
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
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"];

type AudioOrigin = "attachment" | "url" | "resolver" | null;
type RenderResolution = "1080p" | "1440p" | "4k";
type RenderProfile = "fast" | "quality";
type RenderJob = {
  id: string;
  status: "queued" | "rendering" | "completed" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  filename: string;
  resolution: RenderResolution;
  profile: RenderProfile;
  fps: number;
  resolvedConcurrency?: number | null;
  parallelEncoding?: boolean | null;
  hardwareAcceleration?: "if-possible";
  downloadUrl: string | null;
  outputBytes?: number | null;
};

function durationToSeconds(value?: string | null) {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function isAudioFile(file: File) {
  return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension));
}

function filenameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").pop() || "remote-audio");
  } catch {
    return "remote-audio";
  }
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export function MusicEditor() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const coverObjectUrlRef = useRef<string | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const resolverRequestRef = useRef(0);

  const [title, setTitle] = useState("Nostalgia");
  const [artist, setArtist] = useState("BIG Naughty (서동현)");
  const [lyricsText, setLyricsText] = useState(SAMPLE_LYRICS);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioOrigin, setAudioOrigin] = useState<AudioOrigin>(null);
  const [audioImportUrl, setAudioImportUrl] = useState("");
  const [genieSongId, setGenieSongId] = useState<string | null>(null);
  const [duration, setDuration] = useState(180);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isImportingAudio, setIsImportingAudio] = useState(false);
  const [isResolvingAudio, setIsResolvingAudio] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("soft");
  const [motionIntensity, setMotionIntensity] = useState(1);
  const [theme, setTheme] = useState<ThemePreset>("warm");
  const [renderResolution, setRenderResolution] = useState<RenderResolution>("1080p");
  const [renderProfile, setRenderProfile] = useState<RenderProfile>("fast");
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderElapsed, setRenderElapsed] = useState(0);

  const lyrics = useMemo(() => parseLyrics(lyricsText), [lyricsText]);
  const isRendering = renderJob?.status === "queued" || renderJob?.status === "rendering";
  const renderJobId = renderJob?.id;
  const selectedFps = renderProfile === "quality" ? 60 : 30;
  const activeFps = renderJob?.fps ?? selectedFps;

  useEffect(() => {
    if (audioUrl || !isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => (value >= duration ? 0 : Math.min(duration, value + 0.1)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [audioUrl, duration, isPlaying]);

  useEffect(() => {
    if (!isRendering) {
      setRenderElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setRenderElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isRendering, renderJobId]);

  useEffect(() => {
    if (!renderJobId || !isRendering) return;
    let active = true;

    const poll = async () => {
      try {
        const response = await fetch(`/api/render/${renderJobId}`, { cache: "no-store" });
        const payload = (await response.json()) as RenderJob & { error?: string };
        if (!active) return;
        if (!response.ok) throw new Error(payload.error || "렌더 상태를 확인하지 못했습니다.");
        setRenderJob(payload);
        if (payload.status === "failed") setRenderError(payload.error || "영상 생성에 실패했습니다.");
        if (payload.status === "cancelled") setRenderError("영상 생성이 취소되었습니다.");
      } catch (error) {
        if (active) setRenderError(error instanceof Error ? error.message : "렌더 상태 확인에 실패했습니다.");
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isRendering, renderJobId]);

  useEffect(() => {
    return () => {
      resolverRequestRef.current += 1;
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    };
  }, []);

  const cancelAudioResolver = () => {
    resolverRequestRef.current += 1;
    setIsResolvingAudio(false);
  };

  const loadCover = (file?: File) => {
    if (!file) return;
    if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    coverObjectUrlRef.current = nextUrl;
    setCoverUrl(nextUrl);
    setCoverFile(file);
    setCoverName(file.name);
    setGenieSongId(null);
  };

  const loadAudio = (file?: File, origin: AudioOrigin = "attachment") => {
    if (!file) return;
    if (!isAudioFile(file)) {
      setMediaError("지원하는 음원 파일이 아닙니다. MP3, WAV, M4A, AAC, FLAC, OGG, OPUS를 사용해 주세요.");
      return;
    }
    if (origin !== "resolver") cancelAudioResolver();
    audioRef.current?.pause();
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    audioObjectUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
    setAudioFile(file);
    setAudioName(file.name);
    setAudioOrigin(origin);
    setCurrentTime(0);
    setIsPlaying(false);
    setMediaError(null);
    setRenderError(null);
  };

  const loadLyricsFile = async (file?: File) => {
    if (!file) return;
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error("빈 가사 파일입니다.");
      setLyricsText(content);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "가사 파일을 읽지 못했습니다.");
    }
  };

  const importAudioFromUrl = async (rawUrl: string, suggestedFilename?: string | null, origin: AudioOrigin = "url", quiet = false) => {
    const cleanUrl = rawUrl.trim();
    if (!cleanUrl) {
      if (!quiet) setMediaError("음원 URL을 입력해 주세요.");
      return false;
    }
    if (origin !== "resolver") cancelAudioResolver();
    setIsImportingAudio(true);
    if (!quiet) setMediaError(null);

    try {
      const response = await fetch(`/api/media/import?url=${encodeURIComponent(cleanUrl)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "음원을 가져오지 못했습니다.");
      }
      const blob = await response.blob();
      const filename = suggestedFilename?.trim() || filenameFromUrl(cleanUrl);
      loadAudio(new File([blob], filename, { type: blob.type || "audio/mpeg" }), origin);
      setAudioImportUrl(cleanUrl);
      return true;
    } catch (error) {
      if (!quiet) setMediaError(error instanceof Error ? error.message : "음원을 가져오지 못했습니다.");
      return false;
    } finally {
      setIsImportingAudio(false);
    }
  };

  const resolveAudioForSelection = async (selection: GenieSelection) => {
    const requestId = resolverRequestRef.current + 1;
    resolverRequestRef.current = requestId;
    setIsResolvingAudio(true);
    try {
      const params = new URLSearchParams({
        provider: "genie",
        songId: selection.source.song_id,
        title: selection.song.title,
        artist: selection.song.artist,
      });
      const response = await fetch(`/api/audio/resolve?${params.toString()}`);
      if (requestId !== resolverRequestRef.current || response.status === 204 || !response.ok) return;
      const payload = (await response.json()) as { url?: string; filename?: string | null };
      if (requestId !== resolverRequestRef.current || !payload.url) return;
      await importAudioFromUrl(payload.url, payload.filename, "resolver", true);
    } finally {
      if (requestId === resolverRequestRef.current) setIsResolvingAudio(false);
    }
  };

  const applyGenieSelection = (selection: GenieSelection) => {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = null;
    }
    setTitle(selection.song.title?.trim() || title);
    setArtist(selection.song.artist?.trim() || artist);
    setGenieSongId(selection.source.song_id);
    setCoverFile(null);
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
    void resolveAudioForSelection(selection);
  };

  const togglePlay = async () => {
    if (!audioUrl || !audioRef.current) {
      setIsPlaying((value) => !value);
      return;
    }
    if (audioRef.current.paused) await audioRef.current.play();
    else audioRef.current.pause();
  };

  const seek = (value: number) => {
    const safe = Math.max(0, Math.min(duration, value));
    setCurrentTime(safe);
    if (audioRef.current) audioRef.current.currentTime = safe;
  };

  const exportProject = () => {
    const project = {
      version: 1,
      metadata: { title, artist },
      lyrics: lyricsText,
      appearance: { theme, motionPreset, motionIntensity },
      render: { resolution: renderResolution, profile: renderProfile, fps: selectedFps },
      media: { audioName, audioOrigin, coverName },
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

  const renderVideo = async () => {
    if (!audioFile) {
      setRenderError("먼저 음원을 자동으로 불러오거나 파일로 첨부해 주세요.");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setRenderError("음원 길이를 확인할 수 없습니다. 음원을 다시 불러와 주세요.");
      return;
    }

    setRenderError(null);
    setRenderJob(null);
    audioRef.current?.pause();

    try {
      const form = new FormData();
      form.append("audio", audioFile, audioFile.name);
      if (coverFile) form.append("cover", coverFile, coverFile.name);
      else if (coverUrl?.startsWith("https://")) form.append("coverUrl", coverUrl);
      form.append("title", title);
      form.append("artist", artist);
      form.append("lyrics", lyricsText);
      form.append("duration", String(duration));
      form.append("motionPreset", motionPreset);
      form.append("motionIntensity", String(motionIntensity));
      form.append("theme", theme);
      form.append("resolution", renderResolution);
      form.append("renderProfile", renderProfile);

      const response = await fetch("/api/render?async=1", { method: "POST", body: form });
      const payload = (await response.json().catch(() => null)) as RenderJob | { error?: string | null } | null;
      if (!response.ok || !payload || !("id" in payload)) {
        const fallback = `영상 생성 요청에 실패했습니다. (HTTP ${response.status})`;
        const message = payload && "error" in payload && payload.error ? payload.error : fallback;
        throw new Error(message);
      }
      setRenderJob(payload);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "영상 생성 요청에 실패했습니다.");
    }
  };

  const cancelRender = async () => {
    if (!renderJob || !isRendering) return;
    await fetch(`/api/render/${renderJob.id}`, { method: "DELETE" }).catch(() => undefined);
    setRenderJob((job) => (job ? { ...job, status: "cancelled" } : job));
  };

  const downloadRender = () => {
    if (!renderJob?.downloadUrl) return;
    const anchor = document.createElement("a");
    anchor.href = renderJob.downloadUrl;
    anchor.download = renderJob.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <div className="eyebrow"><Sparkles size={14} /> MusicTube Studio</div>
          <h1>음악 영상 생성기</h1>
          <p>Genie 검색부터 음원 연결, 싱크 가사, 애니메이션, MP4 출력까지 로컬에서 한 번에 처리합니다.</p>
        </div>
        <div className="header-actions">
          <span className="status-pill"><span /> {isRendering ? `Rendering ${Math.round((renderJob?.progress ?? 0) * 100)}%` : "Ready"}</span>
          <button className="secondary-button" type="button" onClick={exportProject} disabled={isRendering}>
            <Download size={16} /> 프로젝트 저장
          </button>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="editor-panel">
          <section className="control-section">
            <div className="section-title"><span>01</span><div><strong>Genie</strong><small>메타데이터 · 앨범아트 · 싱크 가사</small></div></div>
            <GenieSearch onApply={applyGenieSelection} />
            {isResolvingAudio ? <div className="helper-row"><span>연결된 음원 소스에서 자동 검색 중…</span><LoaderCircle className="spin-icon" size={12} /></div> : null}
          </section>

          <section className="control-section">
            <div className="section-title"><span>02</span><div><strong>Media</strong><small>자동 가져오기 또는 직접 첨부</small></div></div>
            <label className="upload-card">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadCover(event.target.files?.[0])} />
              <div className="upload-icon"><ImagePlus size={19} /></div>
              <div className="upload-copy"><strong>{coverName ?? "앨범아트 첨부"}</strong><span>PNG, JPG, WEBP</span></div>
              <Upload size={16} />
            </label>
            <label className="upload-card" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadAudio(event.dataTransfer.files?.[0]); }}>
              <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus" onChange={(event) => loadAudio(event.target.files?.[0])} />
              <div className="upload-icon"><Music2 size={19} /></div>
              <div className="upload-copy"><strong>{audioName ?? "음원 첨부 또는 드래그"}</strong><span>{audioOrigin ? `source · ${audioOrigin}` : "MP3, WAV, M4A, AAC, FLAC, OGG"}</span></div>
              <Upload size={16} />
            </label>
            <label className="field-label">음원 URL<input value={audioImportUrl} onChange={(event) => setAudioImportUrl(event.target.value)} placeholder="https://.../song.mp3" inputMode="url" /></label>
            <button className="secondary-button full-button" type="button" disabled={isImportingAudio || isRendering} onClick={() => void importAudioFromUrl(audioImportUrl)}>
              {isImportingAudio ? <LoaderCircle className="spin-icon" size={15} /> : <Link2 size={15} />}{isImportingAudio ? "음원 가져오는 중" : "URL에서 음원 가져오기"}
            </button>
            <div className="helper-row"><span>HTTPS · 최대 160 MB</span><span>직접 다운로드 가능한 음원</span></div>
            {mediaError ? <div className="inline-error">{mediaError}</div> : null}
          </section>

          <section className="control-section">
            <div className="section-title"><span>03</span><div><strong>Metadata</strong><small>곡에 표시할 제목과 실제 아티스트</small></div></div>
            <label className="field-label">제목<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field-label">아티스트<input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Genie에서 실제 아티스트명을 자동으로 불러옵니다" /></label>
            <div className="helper-row"><span>채널/로고 텍스트는 영상에서 제거됨</span><span>{genieSongId ? "Genie metadata" : "직접 수정 가능"}</span></div>
          </section>

          <section className="control-section">
            <div className="section-title"><span>04</span><div><strong>Lyrics</strong><small>LRC 입력 또는 파일 첨부</small></div></div>
            <label className="upload-card lyrics-upload">
              <input type="file" accept=".lrc,text/plain" onChange={(event) => void loadLyricsFile(event.target.files?.[0])} />
              <div className="upload-icon"><FileText size={18} /></div><div className="upload-copy"><strong>LRC 가사 첨부</strong><span>.lrc / text</span></div><Upload size={16} />
            </label>
            <textarea className="lyrics-editor" value={lyricsText} onChange={(event) => setLyricsText(event.target.value)} spellCheck={false} placeholder="[00:12.30]첫 번째 가사" />
            <div className="helper-row"><span>{lyrics.length} lines</span><span>{genieSongId ? `Genie #${genieSongId}` : "[mm:ss.xx] 형식"}</span></div>
          </section>

          <section className="control-section">
            <div className="section-title"><span>05</span><div><strong>Motion</strong><small>전환 감도와 분위기</small></div></div>
            <div className="segmented-control">
              {(["soft", "cinematic", "minimal"] as MotionPreset[]).map((preset) => <button key={preset} type="button" className={motionPreset === preset ? "active" : ""} onClick={() => setMotionPreset(preset)}>{preset === "soft" ? "Soft" : preset === "cinematic" ? "Cinema" : "Minimal"}</button>)}
            </div>
            <label className="range-label"><div><span>애니메이션 강도</span><strong>{motionIntensity.toFixed(1)}×</strong></div><input type="range" min="0.6" max="1.4" step="0.1" value={motionIntensity} onChange={(event) => setMotionIntensity(Number(event.target.value))} /></label>
            <div className="theme-grid">{(["warm", "cool", "mono"] as ThemePreset[]).map((item) => <button key={item} type="button" className={`theme-swatch theme-swatch--${item} ${theme === item ? "active" : ""}`} onClick={() => setTheme(item)} aria-label={`${item} theme`}><span /></button>)}</div>
          </section>

          <section className="control-section export-section">
            <div className="section-title"><span>06</span><div><strong>Export</strong><small>H.264 + AAC · GPU 자동 사용</small></div></div>
            <div className="segmented-control resolution-control">
              {(["fast", "quality"] as RenderProfile[]).map((profile) => <button key={profile} type="button" className={renderProfile === profile ? "active" : ""} disabled={isRendering} onClick={() => setRenderProfile(profile)}>{profile === "fast" ? "Fast · 30 FPS" : "Quality · 60 FPS"}</button>)}
            </div>
            <div className="segmented-control resolution-control">
              {(["1080p", "1440p", "4k"] as RenderResolution[]).map((resolution) => <button key={resolution} type="button" className={renderResolution === resolution ? "active" : ""} disabled={isRendering} onClick={() => setRenderResolution(resolution)}>{resolution === "4k" ? "4K" : resolution}</button>)}
            </div>
            <button className="render-button" type="button" disabled={isRendering || !audioFile} onClick={() => void renderVideo()}>
              {isRendering ? <LoaderCircle className="spin-icon" size={18} /> : <Download size={18} />}
              {isRendering ? `${Math.round((renderJob?.progress ?? 0) * 100)}% · ${renderElapsed}s` : `${renderProfile === "fast" ? "Fast" : "Quality"} · ${renderResolution === "4k" ? "4K" : renderResolution} MP4 생성`}
            </button>
            {isRendering ? <button className="secondary-button full-button" type="button" onClick={() => void cancelRender()}><X size={15} /> 렌더 취소</button> : null}
            {renderJob?.status === "completed" && renderJob.downloadUrl ? <button className="secondary-button full-button" type="button" onClick={downloadRender}><Download size={15} /> 완성 영상 다운로드 {formatBytes(renderJob.outputBytes)}</button> : null}
            <div className="helper-row"><span>{renderProfile === "fast" ? "30 FPS · veryfast encoder" : "60 FPS · quality encoder"}</span><span>{audioFile ? "GPU/NVENC auto" : "음원 필요"}</span></div>
            {renderError ? <div className="inline-error">{renderError}</div> : null}
          </section>
        </aside>

        <section className="preview-column">
          <div className="preview-toolbar"><div><strong>Preview</strong><span>1920 × 1080 · 16:9</span></div><div className="preview-badges">{genieSongId ? <span>Genie synced</span> : null}{audioOrigin ? <span>{audioOrigin} audio</span> : null}<span>{selectedFps} FPS export</span><span>{renderResolution === "4k" ? "4K export" : `${renderResolution} export`}</span></div></div>
          <VideoPreview title={title} artist={artist} coverUrl={coverUrl} currentTime={currentTime} duration={duration} isPlaying={isPlaying} lyrics={lyrics} motionPreset={motionPreset} motionIntensity={motionIntensity} theme={theme} onTogglePlay={togglePlay} onSeek={seek} />
          <div className={`render-note ${isRendering ? "render-note--active" : ""}`}>
            <div><strong>{isRendering ? `MP4 렌더링 ${Math.round((renderJob?.progress ?? 0) * 100)}%` : renderJob?.status === "completed" ? "MP4 생성 완료" : "로컬 MP4 생성 준비"}</strong><span>{isRendering ? `${renderResolution === "4k" ? "3840×2160" : renderResolution === "1440p" ? "2560×1440" : "1920×1080"} · ${activeFps} FPS · ${renderJob?.resolvedConcurrency ? `${renderJob.resolvedConcurrency} workers · ` : ""}${renderElapsed}초 경과` : `기본은 Fast 30 FPS이며 NVIDIA GPU가 있으면 NVENC, macOS에서는 VideoToolbox를 자동으로 사용합니다.`}</span></div>
            {renderJob?.status === "completed" && renderJob.downloadUrl ? <button className="coming-pill render-quick-button" type="button" onClick={downloadRender}>Download MP4</button> : <button className="coming-pill render-quick-button" type="button" disabled={isRendering || !audioFile} onClick={() => void renderVideo()}>{isRendering ? "Rendering…" : "Generate MP4"}</button>}
          </div>
        </section>
      </div>

      {audioUrl ? <audio ref={audioRef} src={audioUrl} onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) setDuration(nextDuration); }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} /> : null}
    </main>
  );
}
