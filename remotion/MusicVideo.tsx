import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Heart, MoreVertical, Pause, SkipBack, SkipForward, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { MusicTubeRenderProps, RenderThemePreset } from "./types";

type LyricLine = { time: number; text: string };

const themeFallback: Record<RenderThemePreset, string> = {
  warm: "linear-gradient(130deg, #918b72 0%, #6f6e5f 38%, #575d5d 68%, #343630 100%)",
  cool: "linear-gradient(130deg, #566479 0%, #40505f 42%, #28303b 100%)",
  mono: "linear-gradient(130deg, #777 0%, #4d4d4d 52%, #242424 100%)",
};

const wash: Record<RenderThemePreset, string> = {
  warm:
    "linear-gradient(90deg, rgba(15,16,14,.16), rgba(25,26,23,.04) 42%, rgba(11,12,11,.27)), linear-gradient(180deg, rgba(0,0,0,.08), transparent 30%, rgba(0,0,0,.12))",
  cool:
    "linear-gradient(90deg, rgba(13,18,26,.18), rgba(23,32,42,.04) 44%, rgba(10,13,19,.31)), linear-gradient(180deg, rgba(0,0,0,.08), transparent 30%, rgba(0,0,0,.12))",
  mono:
    "linear-gradient(90deg, rgba(12,12,12,.19), rgba(42,42,42,.03) 45%, rgba(8,8,8,.31)), linear-gradient(180deg, rgba(0,0,0,.06), transparent 30%, rgba(0,0,0,.14))",
};

const bloom: Record<RenderThemePreset, string> = {
  warm:
    "radial-gradient(circle at 67% 51%, rgba(242,239,207,.12), transparent 24%), radial-gradient(circle at 26% 49%, rgba(248,232,196,.07), transparent 30%)",
  cool:
    "radial-gradient(circle at 68% 50%, rgba(197,221,239,.11), transparent 25%), radial-gradient(circle at 27% 50%, rgba(190,210,227,.05), transparent 30%)",
  mono: "radial-gradient(circle at 67% 50%, rgba(255,255,255,.075), transparent 27%)",
};

function parseLrc(input: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    if (!matches.length) continue;
    const lastMatch = matches.at(-1);
    const text = rawLine.slice((lastMatch?.index ?? 0) + (lastMatch?.[0].length ?? 0)).trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        lines.push({ time: minutes * 60 + seconds, text });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function findActiveLyricIndex(lyrics: LyricLine[], time: number) {
  for (let index = lyrics.length - 1; index >= 0; index -= 1) {
    if (time >= lyrics[index].time) return index;
  }
  return -1;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function titleFontSize(value: string) {
  const length = [...value].length;
  if (length <= 12) return 70;
  if (length <= 18) return 62;
  if (length <= 26) return 54;
  if (length <= 36) return 48;
  return 43;
}

function ControlIcon({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  const style: CSSProperties = primary
    ? {
        width: 80,
        height: 80,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(248,248,239,.96)",
        color: "#41443d",
        boxShadow: "0 10px 30px rgba(0,0,0,.17), inset 0 1px 0 rgba(255,255,255,.8)",
      }
    : {
        width: 40,
        height: 40,
        display: "grid",
        placeItems: "center",
        color: "rgba(255,255,255,.78)",
      };
  return <div style={style}>{children}</div>;
}

function LyricStack({
  lyrics,
  index,
  opacity,
  y,
  blur,
}: {
  lyrics: LyricLine[];
  index: number;
  opacity: number;
  y: number;
  blur: number;
}) {
  let visible: LyricLine[];
  let activeOffset = -1;

  if (index < 0) {
    visible = lyrics.slice(0, 3);
  } else {
    const start = Math.max(0, Math.min(index - 1, Math.max(0, lyrics.length - 3)));
    visible = lyrics.slice(start, start + 3);
    activeOffset = index - start;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        opacity,
        transform: `translateY(${y}px)`,
        filter: `blur(${Math.max(0, blur)}px)`,
      }}
    >
      <div style={{ width: "100%", display: "grid", gap: 15, textAlign: "center" }}>
        {visible.length ? (
          visible.map((line, visibleIndex) => {
            const isActive = visibleIndex === activeOffset;
            return (
              <div
                key={`${line.time}-${line.text}-${visibleIndex}`}
                style={{
                  padding: "0 8px",
                  fontSize: isActive ? 32 : 26,
                  lineHeight: isActive ? 1.32 : 1.35,
                  fontWeight: isActive ? 650 : 500,
                  color: isActive ? "rgba(255,255,255,.98)" : "rgba(255,255,255,.50)",
                  letterSpacing: "-0.035em",
                  overflowWrap: "anywhere",
                  textShadow: isActive
                    ? "0 2px 18px rgba(0,0,0,.24), 0 0 26px rgba(255,255,255,.055)"
                    : "0 2px 17px rgba(0,0,0,.22)",
                }}
              >
                {line.text || " "}
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 26, color: "rgba(255,255,255,.48)" }}>가사가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

export function MusicVideo({
  title,
  artist,
  lyrics: lyricSource,
  audioPath,
  coverPath,
  durationSeconds,
  motionPreset,
  motionIntensity,
  theme,
}: MusicTubeRenderProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const lyrics = parseLrc(lyricSource);
  const activeIndex = findActiveLyricIndex(lyrics, seconds);

  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 80, mass: 1 } });
  const titleIntro = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 20, stiffness: 72 } });

  const transitionSeconds = motionPreset === "cinematic" ? 0.76 : motionPreset === "minimal" ? 0.3 : 0.52;
  const transitionFrames = Math.max(1, transitionSeconds * fps * motionIntensity);
  const activeStartFrame = activeIndex >= 0 ? Math.round(lyrics[activeIndex].time * fps) : 0;
  const lineProgress = activeIndex >= 0
    ? clamp01((frame - activeStartFrame) / transitionFrames)
    : clamp01(frame / transitionFrames);
  const easedLineProgress = 1 - Math.pow(1 - lineProgress, 3);
  const showPrevious = activeIndex > 0 && lineProgress < 1;

  const cycle = frame / fps;
  const motionAmount = motionPreset === "minimal" ? 0 : motionIntensity;
  const coverScale = 1 + Math.sin(cycle * 0.49) * 0.007 * motionAmount + 0.008 * motionAmount;
  const coverRotate = motionPreset === "cinematic" ? Math.sin(cycle * 0.32) * 0.14 * motionIntensity : 0;
  const backgroundScale = 1.16 + Math.sin(cycle * 0.16) * 0.018 * motionAmount;
  const backgroundX = Math.sin(cycle * 0.12) * 13 * motionAmount;
  const backgroundY = Math.cos(cycle * 0.1) * 9 * motionAmount;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const coverSrc = coverPath ? staticFile(coverPath) : null;
  const displayTitle = title || "Untitled";

  return (
    <AbsoluteFill
      style={{
        background: themeFallback[theme],
        color: "white",
        fontFamily: 'Inter, "Noto Sans KR", "Noto Sans CJK KR", Arial, sans-serif',
        overflow: "hidden",
      }}
    >
      {audioPath ? <Audio src={staticFile(audioPath)} /> : null}

      <div
        style={{
          position: "absolute",
          inset: -100,
          backgroundImage: coverSrc ? `url(${coverSrc})` : themeFallback[theme],
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(50px) saturate(.72) brightness(.64) contrast(1.04)",
          transform: `translate3d(${backgroundX}px, ${backgroundY}px, 0) scale(${backgroundScale})`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: wash[theme] }} />
      <div style={{ position: "absolute", inset: 0, background: bloom[theme], mixBlendMode: "screen" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 46%, rgba(7,8,7,.22) 79%, rgba(4,5,4,.42) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.07,
          backgroundImage: "radial-gradient(rgba(255,255,255,.34) .55px, transparent .55px)",
          backgroundSize: "4px 4px",
          mixBlendMode: "soft-light",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 1,
          border: "1px solid rgba(255,255,255,.045)",
          boxShadow: "inset 0 0 70px rgba(0,0,0,.06)",
          pointerEvents: "none",
          zIndex: 9,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 58,
          right: 64,
          zIndex: 3,
          display: "grid",
          justifyItems: "center",
          gap: 12,
          color: "rgba(250,249,223,.88)",
          opacity: intro,
        }}
      >
        <X size={44} strokeWidth={2.6} />
        <MoreVertical size={24} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "50.5% 49.5%",
          alignItems: "center",
          padding: "104px 118px 72px 118px",
        }}
      >
        <div style={{ width: "100%", display: "flex", alignItems: "center", position: "relative" }}>
          <div
            style={{
              position: "relative",
              width: "88%",
              aspectRatio: "1 / 1",
              overflow: "hidden",
              background: "#4b4b42",
              boxShadow: "0 22px 60px rgba(0,0,0,.24), 0 1px 0 rgba(255,255,255,.045)",
              opacity: intro,
              transform: `translateX(${interpolate(intro, [0, 1], [-28, 0])}px) scale(${interpolate(intro, [0, 1], [0.955, 1]) * coverScale}) rotate(${coverRotate}deg)`,
              transformOrigin: "center",
            }}
          >
            {coverSrc ? (
              <Img src={coverSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(145deg, rgba(255,255,255,.17), transparent 40%), linear-gradient(135deg,#b8ae86,#7b765e 47%,#4a5148)",
                  letterSpacing: ".12em",
                }}
              >
                <span style={{ fontSize: 20 }}>MUSIC</span>
                <strong style={{ fontSize: 82, lineHeight: 0.92, letterSpacing: "-.08em" }}>TUBE</strong>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(145deg, rgba(255,255,255,.055), transparent 24%, transparent 72%, rgba(0,0,0,.08)), linear-gradient(180deg, transparent 72%, rgba(0,0,0,.07))",
                mixBlendMode: "soft-light",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,.045)",
              }}
            />
          </div>
        </div>

        <div
          style={{
            minWidth: 0,
            height: "81.5%",
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            alignItems: "start",
            padding: "12px 24px 0 38px",
          }}
        >
          <div
            style={{
              opacity: titleIntro,
              transform: `translateY(${interpolate(titleIntro, [0, 1], [26, 0])}px)`,
              minWidth: 0,
            }}
          >
            <div
              style={{
                maxWidth: "100%",
                paddingRight: 26,
                fontSize: titleFontSize(displayTitle),
                lineHeight: 1.03,
                fontWeight: 800,
                letterSpacing: "-.052em",
                textShadow: "0 4px 22px rgba(0,0,0,.2)",
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              {displayTitle}
            </div>
            <div
              style={{
                maxWidth: "100%",
                paddingRight: 26,
                marginTop: 16,
                fontSize: 28,
                lineHeight: 1.22,
                fontWeight: 500,
                color: "rgba(255,255,255,.84)",
                letterSpacing: "-.03em",
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              {artist || "Unknown Artist"}
            </div>
          </div>

          <div
            style={{
              position: "relative",
              minHeight: 0,
              width: "100%",
              paddingRight: 8,
              transform: "translateY(30px)",
            }}
          >
            {showPrevious ? (
              <LyricStack
                lyrics={lyrics}
                index={activeIndex - 1}
                opacity={1 - easedLineProgress}
                y={-14 * easedLineProgress * motionIntensity}
                blur={4 * easedLineProgress}
              />
            ) : null}
            <LyricStack
              lyrics={lyrics}
              index={activeIndex}
              opacity={activeIndex < 0 ? clamp01(frame / transitionFrames) : easedLineProgress}
              y={(1 - easedLineProgress) * 18 * motionIntensity}
              blur={(1 - easedLineProgress) * 5}
            />
          </div>

          <div style={{ width: "100%", alignSelf: "end" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, auto)",
                justifyContent: "center",
                alignItems: "center",
                gap: 41,
              }}
            >
              <ControlIcon><Heart size={32} strokeWidth={1.65} /></ControlIcon>
              <ControlIcon><SkipBack size={32} fill="currentColor" strokeWidth={1.65} /></ControlIcon>
              <ControlIcon primary><Pause size={37} fill="currentColor" strokeWidth={1.7} /></ControlIcon>
              <ControlIcon><SkipForward size={32} fill="currentColor" strokeWidth={1.65} /></ControlIcon>
              <ControlIcon><Heart size={32} strokeWidth={1.65} /></ControlIcon>
            </div>

            <div
              style={{
                marginTop: 31,
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 12,
                color: "rgba(255,255,255,.48)",
                fontSize: 12,
              }}
            >
              <span>{formatTime(seconds)}</span>
              <div style={{ position: "relative", height: 12 }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 5.25, height: 1.5, borderRadius: 99, background: "rgba(255,255,255,.18)" }} />
                <div style={{ position: "absolute", left: 0, top: 5.25, height: 1.5, width: `${Math.max(0, Math.min(100, progress * 100))}%`, borderRadius: 99, background: "rgba(255,255,255,.88)" }} />
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, Math.min(100, progress * 100))}%`,
                    top: 6,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.96)",
                    boxShadow: "0 1px 6px rgba(0,0,0,.22)",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              </div>
              <span>{formatTime(durationSeconds)}</span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
