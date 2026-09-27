"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  Heart,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { findActiveLyricIndex, type LyricLine } from "@/lib/lrc";

export type MotionPreset = "soft" | "cinematic" | "minimal";
export type ThemePreset = "warm" | "cool" | "mono";

type Props = {
  title: string;
  artist: string;
  coverUrl: string | null;
  currentTime: number;
  seekRevision: number;
  duration: number;
  isPlaying: boolean;
  lyrics: LyricLine[];
  motionPreset: MotionPreset;
  motionIntensity: number;
  theme: ThemePreset;
  onTogglePlay: () => void;
  onSeek: (value: number) => void;
};

const themeFallback: Record<ThemePreset, string> = {
  warm: "linear-gradient(130deg, #8f8b73 0%, #706e5f 36%, #5c6060 66%, #343630 100%)",
  cool: "linear-gradient(130deg, #566479 0%, #40505f 42%, #28303b 100%)",
  mono: "linear-gradient(130deg, #777 0%, #4d4d4d 52%, #242424 100%)",
};

const LYRIC_PAGE_SIZE = 3;

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function lyricLengthClass(text: string) {
  const length = [...text].length;
  if (length >= 112) return "lyric-line--xxlong";
  if (length >= 76) return "lyric-line--xlong";
  if (length >= 48) return "lyric-line--long";
  return "";
}

function lyricState(globalIndex: number, activeIndex: number) {
  if (activeIndex < 0 || globalIndex > activeIndex) return "future";
  if (globalIndex < activeIndex) return "past";
  return "active";
}

export function VideoPreview({
  title,
  artist,
  coverUrl,
  currentTime,
  seekRevision,
  duration,
  isPlaying,
  lyrics,
  motionPreset,
  motionIntensity,
  theme,
  onTogglePlay,
  onSeek,
}: Props) {
  const [displayTime, setDisplayTime] = useState(currentTime);
  const timeAnchorRef = useRef({ media: currentTime, clock: 0 });
  const seekRevisionRef = useRef(seekRevision);
  const wasPlayingRef = useRef(false);
  const allowDisplayRegressionRef = useRef(false);

  useEffect(() => {
    const now = performance.now();
    const nextTime = Math.max(0, Math.min(duration, currentTime));
    const explicitSeek = seekRevisionRef.current !== seekRevision;
    const justStarted = isPlaying && !wasPlayingRef.current;
    seekRevisionRef.current = seekRevision;
    wasPlayingRef.current = isPlaying;

    if (!isPlaying || explicitSeek || justStarted) {
      timeAnchorRef.current = { media: nextTime, clock: now };
      allowDisplayRegressionRef.current = true;
      setDisplayTime(nextTime);
      return;
    }

    const anchor = timeAnchorRef.current;
    const predicted = anchor.media + Math.max(0, now - anchor.clock) / 1000;
    const regression = predicted - nextTime;
    // Ignore small backwards clock jitter. A larger jump is an intentional
    // seek (including one made with the embedded player's own controls).
    if (regression > 0 && regression <= 0.18) {
      timeAnchorRef.current = { media: predicted, clock: now };
      return;
    }

    timeAnchorRef.current = { media: nextTime, clock: now };
    if (regression > 0.18) {
      allowDisplayRegressionRef.current = true;
      setDisplayTime(nextTime);
    }
  }, [currentTime, duration, isPlaying, seekRevision]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId = 0;
    let lastPaint = 0;

    const tick = (now: number) => {
      if (now - lastPaint >= 32) {
        const anchor = timeAnchorRef.current;
        const predicted = anchor.media + Math.max(0, now - anchor.clock) / 1000;
        if (allowDisplayRegressionRef.current) {
          allowDisplayRegressionRef.current = false;
          setDisplayTime(Math.min(duration, Math.max(0, predicted)));
        } else {
          setDisplayTime((previous) => Math.min(duration, Math.max(previous, predicted)));
        }
        lastPaint = now;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, isPlaying]);

  const activeIndex = findActiveLyricIndex(lyrics, displayTime);
  // Keep the first lyric below the viewport center before its timestamp so
  // its first transition rises into the active row like every later lyric.
  const pageStart = activeIndex < 0 ? -2 : activeIndex - 1;
  const pageLines = Array.from({ length: LYRIC_PAGE_SIZE }, (_, lineIndex) => {
    const globalIndex = pageStart + lineIndex;
    return { line: lyrics[globalIndex] ?? null, globalIndex };
  });

  const transition = {
    soft: { duration: 0.52 * motionIntensity, ease: [0.22, 1, 0.36, 1] as const },
    cinematic: { duration: 0.78 * motionIntensity, ease: [0.16, 1, 0.3, 1] as const },
    minimal: { duration: 0.3 * motionIntensity, ease: "easeOut" as const },
  }[motionPreset];

  const lyricTransition = {
    soft: { duration: 0.42 * Math.max(0.85, motionIntensity), ease: [0.22, 1, 0.36, 1] as const },
    cinematic: { duration: 0.5 * Math.max(0.85, motionIntensity), ease: [0.16, 1, 0.3, 1] as const },
    minimal: { duration: 0.28 * Math.max(0.85, motionIntensity), ease: [0.22, 1, 0.36, 1] as const },
  }[motionPreset];

  const progress = duration > 0 ? Math.min(1, displayTime / duration) : 0;

  return (
    <section className={`video-shell theme-${theme}`}>
      <div
        className={`ambient-bg ${isPlaying ? "ambient-bg--playing" : ""}`}
        style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : themeFallback[theme] }}
      />
      <div className="ambient-wash" />
      <div className="ambient-bloom" />
      <div className="ambient-vignette" />
      <div className="video-noise" />
      <div className="video-inner-frame" />
      <div className="video-grid">
        <motion.div
          className="cover-stage"
          initial={{ opacity: 0, scale: 0.95, x: -18 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ delay: 0.05, ...transition }}
        >
          <motion.div
            className="cover-wrap"
            animate={
              isPlaying
                ? {
                    scale: motionPreset === "minimal" ? 1 : [1, 1.016, 1],
                    rotate: motionPreset === "cinematic" ? [0, 0.16, 0] : 0,
                  }
                : { scale: 1, rotate: 0 }
            }
            transition={{ duration: 13 / Math.max(0.7, motionIntensity), repeat: Infinity, ease: "easeInOut" }}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="Album cover preview" className="cover-image" />
            ) : (
              <div className="cover-placeholder">
                <span>MUSIC</span>
                <strong>TUBE</strong>
                <small>DROP COVER ART</small>
              </div>
            )}
            <div className="cover-sheen" />
          </motion.div>
        </motion.div>

        <div className="track-panel" style={{ padding: "1.2% 3.6% 0" }}>
          <motion.div
            className="track-heading"
            style={{ textAlign: "center" }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, ...transition }}
          >
            <h2
              style={{
                maxWidth: "100%",
                fontSize: "clamp(22px, 2.8vw, 48px)",
                lineHeight: 1.02,
                whiteSpace: "normal",
                overflow: "visible",
                textOverflow: "clip",
                overflowWrap: "anywhere",
              }}
            >
              {title || "Untitled"}
            </h2>
            <p
              style={{
                maxWidth: "100%",
                whiteSpace: "normal",
                overflow: "visible",
                textOverflow: "clip",
              }}
            >
              {artist || "Unknown Artist"}
            </p>
          </motion.div>

          <div className="lyrics-stage" aria-live="polite">
            {lyrics.length ? (
              <AnimatePresence initial={false} mode="sync">
                <motion.div
                  className="lyrics-page"
                  key="lyrics-page"
                  initial={{ opacity: 0, y: 7 * motionIntensity }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 * motionIntensity }}
                  transition={lyricTransition}
                >
                  <AnimatePresence initial={false} mode="sync">
                  {pageLines.map(({ line, globalIndex }, lineIndex) => {
                    const lineKey = line
                      ? `${line.time}-${globalIndex}`
                      : `empty-${globalIndex}`;
                    if (!line) {
                      return (
                        <div
                          className="lyrics-page-line lyrics-page-line--empty"
                          key={lineKey}
                          style={{ gridRow: lineIndex + 1 }}
                          aria-hidden="true"
                        >
                          <div className="lyric-line">&nbsp;</div>
                        </div>
                      );
                    }

                    const state = lyricState(globalIndex, activeIndex);
                    return (
                      <motion.div
                        className={`lyrics-page-line lyrics-page-line--${state}`}
                        key={lineKey}
                        layout="position"
                        style={{ gridRow: lineIndex + 1 }}
                        initial={{ y: "110%" }}
                        animate={{ y: 0 }}
                        exit={lineIndex === 0 ? { opacity: 0, y: 0 } : { y: "-110%" }}
                        transition={lyricTransition}
                      >
                        <div className={`lyric-line ${lyricLengthClass(line.text)}`.trim()}>{line.text || " "}</div>
                      </motion.div>
                    );
                  })}
                  </AnimatePresence>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="lyric-empty-state">가사를 입력하면 여기에 표시됩니다.</div>
            )}
          </div>

          <div className="player-area">
            <div className="player-controls">
              <button className="ghost-control" type="button" aria-label="Like preview"><Heart /></button>
              <button className="ghost-control" type="button" aria-label="Previous preview"><SkipBack fill="currentColor" /></button>
              <motion.button
                className="main-play"
                type="button"
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
                onClick={onTogglePlay}
                whileTap={{ scale: 0.92 }}
              >
                {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </motion.button>
              <button className="ghost-control" type="button" aria-label="Next preview"><SkipForward fill="currentColor" /></button>
              <button className="ghost-control" type="button" aria-label="Favorite preview"><Heart /></button>
            </div>

            <div className="timeline-row">
              <span>{formatTime(displayTime)}</span>
              <button
                className="timeline"
                type="button"
                aria-label="Seek preview"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
                  onSeek(ratio * duration);
                }}
              >
                <span className="timeline-fill" style={{ transform: `translateY(-50%) scaleX(${progress})` }} />
                <span className="timeline-thumb" style={{ left: `${progress * 100}%` }} />
              </button>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
