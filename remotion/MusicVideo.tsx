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
import { Heart, Pause, SkipBack, SkipForward } from "lucide-react";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { MusicTubeRenderProps, RenderThemePreset } from "./types";

type LyricLine = { time: number; text: string; fontSize: number; lineHeight: number };

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
        lines.push({
          time: minutes * 60 + seconds,
          text,
          fontSize: lyricFontSize(text),
          lineHeight: lyricLineHeight(text),
        });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function findActiveLyricIndex(lyrics: LyricLine[], time: number) {
  let low = 0;
  let high = lyrics.length - 1;
  let activeIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (time >= lyrics[middle].time) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return activeIndex;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number) {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

function lyricFontSize(value: string) {
  const length = [...value].length;
  if (length >= 112) return 24;
  if (length >= 76) return 28;
  if (length >= 48) return 32;
  return 38;
}

function lyricLineHeight(value: string) {
  const length = [...value].length;
  if (length >= 112) return 1.28;
  if (length >= 76) return 1.3;
  if (length >= 48) return 1.32;
  return 1.36;
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

function LyricPage({
  lines,
  scrollPosition,
  rowHeight,
}: {
  lines: LyricLine[];
  scrollPosition: number;
  rowHeight: number;
}) {
  const firstIndex = Math.max(0, Math.floor(scrollPosition) - 1);
  const lastIndex = Math.min(lines.length - 1, Math.ceil(scrollPosition) + 1);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: Math.max(0, lastIndex - firstIndex + 1) }, (_, offset) => {
        const globalIndex = firstIndex + offset;
        const line = lines[globalIndex];
        const relativePosition = globalIndex - scrollPosition;
        const distance = Math.abs(relativePosition);
        const highlight = clamp01(1 - distance);
        const lineOpacity = interpolate(distance, [0, 0.72, 1, 1.35, 1.75], [1, 1, 0.58, 0.18, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const colorAlpha = 0.72 + 0.27 * highlight;
        const fontWeight = Math.round(500 + 180 * highlight);

        return (
          <div
            key={`${line.time}-${globalIndex}`}
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              width: "100%",
              height: rowHeight,
              display: "grid",
              placeItems: "center",
              transform: `translate3d(0, calc(-50% + ${relativePosition * rowHeight}px), 0)`,
              borderRadius: 5,
              background: `linear-gradient(90deg, rgba(95,126,203,${0.29 * highlight}), rgba(95,126,203,${0.2 * highlight}))`,
              boxShadow:
                highlight > 0.02
                  ? `inset 2px 0 0 rgba(190,207,255,${0.44 * highlight}), 0 7px 22px rgba(0,0,0,${0.07 * highlight})`
                  : "none",
              overflow: "visible",
            }}
          >
            <div
              style={{
                width: "100%",
                padding: "1px 18px",
                fontSize: line.fontSize,
                lineHeight: line.lineHeight,
                fontWeight,
                color: `rgba(255,255,255,${colorAlpha})`,
                opacity: lineOpacity,
                letterSpacing: "-.038em",
                whiteSpace: "normal",
                overflow: "visible",
                overflowWrap: "break-word",
                wordBreak: "keep-all",
                textAlign: "center",
                textShadow:
                  highlight > 0.45
                    ? "0 2px 18px rgba(0,0,0,.3), 0 0 24px rgba(225,233,255,.08)"
                    : "0 2px 17px rgba(0,0,0,.18)",
              }}
            >
              {line.text || " "}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MusicVideo({
  title,
  artist,
  lyrics: lyricSource,
  audioPath,
  coverPath,
  backdropPath,
  durationSeconds,
  motionPreset,
  motionIntensity,
  theme,
}: MusicTubeRenderProps) {
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames } = useVideoConfig();
  const seconds = frame / fps;
  const lyrics = useMemo(() => parseLrc(lyricSource), [lyricSource]);
  const activeIndex = findActiveLyricIndex(lyrics, seconds);

  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 80, mass: 1 } });
  const titleIntro = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 20, stiffness: 72 } });
  const transitionSeconds =
    motionPreset === "cinematic"
      ? 0.56 * Math.max(0.85, motionIntensity)
      : motionPreset === "minimal"
        ? 0.22 * Math.max(0.85, motionIntensity)
        : 0.42 * Math.max(0.85, motionIntensity);
  const transitionFrames = Math.max(1, transitionSeconds * fps);
  const rowHeight = height * 0.12;
  const activeStartFrame = activeIndex >= 0 ? Math.round(lyrics[activeIndex].time * fps) : 0;
  const nextStartFrame = activeIndex >= 0 && activeIndex < lyrics.length - 1
    ? Math.round(lyrics[activeIndex + 1].time * fps)
    : Number.POSITIVE_INFINITY;
  const lyricScrollFrames = Math.max(1, Math.min(transitionFrames, nextStartFrame - activeStartFrame));
  const lyricScrollProgress = activeIndex >= 0
    ? easeInOutCubic((frame - activeStartFrame) / lyricScrollFrames)
    : 0;
  const scrollPosition = activeIndex >= 0 ? activeIndex - 1 + lyricScrollProgress : -1;

  const cycle = frame / fps;
  const motionAmount = motionPreset === "minimal" ? 0 : motionIntensity;
  const coverScale = 1 + Math.sin(cycle * 0.49) * 0.007 * motionAmount + 0.008 * motionAmount;
  const coverRotate = motionPreset === "cinematic" ? Math.sin(cycle * 0.32) * 0.14 * motionIntensity : 0;
  const backgroundScale = 1.16 + Math.sin(cycle * 0.16) * 0.018 * motionAmount;
  const backgroundX = Math.sin(cycle * 0.12) * 13 * motionAmount;
  const backgroundY = Math.cos(cycle * 0.1) * 9 * motionAmount;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const coverSrc = coverPath ? staticFile(coverPath) : null;
  const backdropSrc = backdropPath ? staticFile(backdropPath) : null;
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
          backgroundImage: backdropSrc
            ? `url(${backdropSrc})`
            : coverSrc
              ? `url(${coverSrc})`
              : themeFallback[theme],
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: coverSrc && !backdropSrc ? "blur(50px) saturate(.72) brightness(.64) contrast(1.04)" : "none",
          transform: `translate3d(${backgroundX}px, ${backgroundY}px, 0) scale(${backgroundScale})`,
          willChange: "transform",
        }}
      />
      {!backdropSrc ? (
        <>
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
        </>
      ) : null}
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
              willChange: "transform",
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
                <small style={{ marginTop: 16, fontSize: 10, opacity: 0.62 }}>DROP COVER ART</small>
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
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            padding: "12px 24px 0 38px",
            overflow: "visible",
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
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
              flex: "1 1 auto",
              minHeight: 0,
              width: "100%",
              marginTop: 12,
              overflow: "visible",
            }}
          >
            {lyrics.length ? (
              <LyricPage lines={lyrics} scrollPosition={scrollPosition} rowHeight={rowHeight} />
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 24,
                  color: "rgba(255,255,255,.52)",
                }}
              >
                가사가 없습니다.
              </div>
            )}
          </div>

          <div style={{ width: "100%", flex: "0 0 auto", paddingTop: 14 }}>
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
