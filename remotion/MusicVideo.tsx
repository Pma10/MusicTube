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
    "linear-gradient(90deg, rgba(27,28,25,.18), rgba(29,31,31,.08) 50%, rgba(22,23,23,.30)), radial-gradient(circle at 72% 65%, rgba(226,229,210,.17), transparent 30%)",
  cool:
    "linear-gradient(90deg, rgba(19,26,37,.21), rgba(30,44,55,.09) 50%, rgba(19,22,30,.38)), radial-gradient(circle at 72% 66%, rgba(182,211,230,.14), transparent 30%)",
  mono: "linear-gradient(115deg, rgba(28,28,28,.24), rgba(70,70,70,.11), rgba(20,20,20,.36))",
};

function parseLrc(input: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    if (!matches.length) continue;
    const text = rawLine.slice((matches.at(-1)?.index ?? 0) + (matches.at(-1)?.[0].length ?? 0)).trim();
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

function formatTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function ControlIcon({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  const style: CSSProperties = primary
    ? {
        width: 84,
        height: 84,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,.96)",
        color: "#4b4d46",
        boxShadow: "0 8px 28px rgba(0,0,0,.14)",
      }
    : {
        width: 40,
        height: 40,
        display: "grid",
        placeItems: "center",
        color: "rgba(255,255,255,.92)",
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
  const visible = index < 0 ? lyrics.slice(0, 3) : lyrics.slice(index, index + 3);
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
      <div style={{ width: "100%", display: "grid", gap: 13, textAlign: "center" }}>
        {visible.length ? (
          visible.map((line, visibleIndex) => (
            <div
              key={`${line.time}-${line.text}-${visibleIndex}`}
              style={{
                fontSize: 27,
                lineHeight: 1.35,
                fontWeight: visibleIndex === 0 && index >= 0 ? 650 : 500,
                color:
                  visibleIndex === 0 && index >= 0
                    ? "rgba(255,255,255,.99)"
                    : "rgba(255,255,255,.70)",
                letterSpacing: "-0.035em",
                textShadow: "0 2px 16px rgba(0,0,0,.2)",
              }}
            >
              {line.text || " "}
            </div>
          ))
        ) : (
          <div style={{ fontSize: 25, color: "rgba(255,255,255,.55)" }}>가사가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

export function MusicVideo({
  title,
  artist,
  channel,
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

  const transitionSeconds =
    motionPreset === "cinematic" ? 0.76 : motionPreset === "minimal" ? 0.3 : 0.52;
  const transitionFrames = Math.max(1, transitionSeconds * fps * motionIntensity);
  const activeStartFrame = activeIndex >= 0 ? Math.round(lyrics[activeIndex].time * fps) : 0;
  const lineProgress = activeIndex >= 0 ? clamp01((frame - activeStartFrame) / transitionFrames) : clamp01(frame / transitionFrames);
  const showPrevious = activeIndex > 0 && lineProgress < 1;

  const cycle = frame / fps;
  const motionAmount = motionPreset === "minimal" ? 0 : motionIntensity;
  const coverScale = 1 + Math.sin(cycle * 0.52) * 0.008 * motionAmount + 0.009 * motionAmount;
  const coverRotate = motionPreset === "cinematic" ? Math.sin(cycle * 0.34) * 0.16 * motionIntensity : 0;
  const backgroundScale = 1.14 + Math.sin(cycle * 0.17) * 0.018 * motionAmount;
  const backgroundX = Math.sin(cycle * 0.13) * 12 * motionAmount;
  const backgroundY = Math.cos(cycle * 0.11) * 8 * motionAmount;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const coverSrc = coverPath ? staticFile(coverPath) : null;

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
          inset: -70,
          backgroundImage: coverSrc ? `url(${coverSrc})` : themeFallback[theme],
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(44px) saturate(.76) brightness(.72)",
          transform: `translate3d(${backgroundX}px, ${backgroundY}px, 0) scale(${backgroundScale})`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: wash[theme] }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,.34) .55px, transparent .55px)",
          backgroundSize: "4px 4px",
          mixBlendMode: "soft-light",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 66,
          top: 54,
          opacity: intro,
          transform: `translateY(${interpolate(intro, [0, 1], [-12, 0])}px)`,
          color: "#fbf7dd",
          zIndex: 3,
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.045em" }}>{channel || "MUSICTUBE"}</div>
        <div
          style={{
            position: "absolute",
            left: "92%",
            top: -2,
            width: 110,
            fontSize: 10,
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: ".08em",
            transform: "rotate(48deg)",
            opacity: 0.9,
          }}
        >
          PLAYING · MUSIC · LOOP ·
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 54,
          right: 58,
          zIndex: 3,
          display: "grid",
          justifyItems: "center",
          gap: 14,
          color: "rgba(250,249,223,.88)",
          opacity: intro,
        }}
      >
        <X size={48} strokeWidth={2.8} />
        <MoreVertical size={28} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "51% 49%",
          alignItems: "center",
          padding: "100px 130px 72px 118px",
        }}
      >
        <div style={{ width: "100%", display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: "89%",
              aspectRatio: "1 / 1",
              overflow: "hidden",
              background: "#4b4b42",
              boxShadow: "0 18px 55px rgba(0,0,0,.18)",
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
                <strong style={{ fontSize: 82, lineHeight: .92, letterSpacing: "-.08em" }}>TUBE</strong>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            minWidth: 0,
            height: "80%",
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            alignItems: "start",
            padding: "16px 18px 0 36px",
          }}
        >
          <div
            style={{
              opacity: titleIntro,
              transform: `translateY(${interpolate(titleIntro, [0, 1], [26, 0])}px)`,
            }}
          >
            <div
              style={{
                maxWidth: "92%",
                fontSize: 72,
                lineHeight: .98,
                fontWeight: 800,
                letterSpacing: "-.055em",
                textShadow: "0 4px 18px rgba(0,0,0,.17)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title || "Untitled"}
            </div>
            <div
              style={{
                marginTop: 16,
                fontSize: 31,
                color: "rgba(255,255,255,.9)",
                letterSpacing: "-.035em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {artist || "Unknown Artist"}
            </div>
          </div>

          <div style={{ position: "relative", minHeight: 0, width: "100%" }}>
            {showPrevious ? (
              <LyricStack
                lyrics={lyrics}
                index={activeIndex - 1}
                opacity={1 - lineProgress}
                y={-14 * lineProgress * motionIntensity}
                blur={4 * lineProgress}
              />
            ) : null}
            <LyricStack
              lyrics={lyrics}
              index={activeIndex}
              opacity={activeIndex < 0 ? clamp01(frame / transitionFrames) : lineProgress}
              y={(1 - lineProgress) * 18 * motionIntensity}
              blur={(1 - lineProgress) * 5}
            />
          </div>

          <div style={{ width: "100%", alignSelf: "end" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, auto)", justifyContent: "center", alignItems: "center", gap: 45 }}>
              <ControlIcon><Heart size={34} /></ControlIcon>
              <ControlIcon><SkipBack size={34} fill="currentColor" /></ControlIcon>
              <ControlIcon primary><Pause size={39} fill="currentColor" /></ControlIcon>
              <ControlIcon><SkipForward size={34} fill="currentColor" /></ControlIcon>
              <ControlIcon><Heart size={34} /></ControlIcon>
            </div>

            <div
              style={{
                marginTop: 34,
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 12,
                color: "rgba(255,255,255,.58)",
                fontSize: 12,
              }}
            >
              <span>{formatTime(seconds)}</span>
              <div style={{ position: "relative", height: 12 }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 5, height: 2, borderRadius: 99, background: "rgba(255,255,255,.24)" }} />
                <div style={{ position: "absolute", left: 0, top: 5, height: 2, width: `${Math.max(0, Math.min(100, progress * 100))}%`, borderRadius: 99, background: "rgba(255,255,255,.92)" }} />
              </div>
              <span>{formatTime(durationSeconds)}</span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
