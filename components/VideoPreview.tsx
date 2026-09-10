"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  Heart,
  MoreVertical,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { findActiveLyricIndex, type LyricLine } from "@/lib/lrc";

export type MotionPreset = "soft" | "cinematic" | "minimal";
export type ThemePreset = "warm" | "cool" | "mono";

type Props = {
  title: string;
  artist: string;
  coverUrl: string | null;
  currentTime: number;
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
  if (length >= 90) return "lyric-line--xxlong";
  if (length >= 54) return "lyric-line--xlong";
  if (length >= 34) return "lyric-line--long";
  return "";
}

function lyricIndexes(length: number, focus: number) {
  if (!length || focus < 0) return [];
  const indexes: number[] = [];
  for (let index = Math.max(0, focus - 2); index <= Math.min(length - 1, focus + 2); index += 1) {
    indexes.push(index);
  }
  return indexes;
}

export function VideoPreview({
  title,
  artist,
  coverUrl,
  currentTime,
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

  useEffect(() => {
    timeAnchorRef.current = { media: currentTime, clock: performance.now() };
    if (!isPlaying) setDisplayTime(currentTime);
  }, [currentTime, isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId = 0;
    let lastPaint = 0;

    const tick = (now: number) => {
      if (now - lastPaint >= 32) {
        const anchor = timeAnchorRef.current;
        const predicted = anchor.media + Math.max(0, now - anchor.clock) / 1000;
        setDisplayTime(Math.min(duration, Math.max(0, predicted)));
        lastPaint = now;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, isPlaying]);

  const activeIndex = findActiveLyricIndex(lyrics, displayTime);
  const focusIndex = lyrics.length ? Math.max(0, activeIndex) : -1;
  const indexes = lyricIndexes(lyrics.length, focusIndex);

  const transition = {
    soft: { duration: 0.52 * motionIntensity, ease: [0.22, 1, 0.36, 1] as const },
    cinematic: { duration: 0.78 * motionIntensity, ease: [0.16, 1, 0.3, 1] as const },
    minimal: { duration: 0.3 * motionIntensity, ease: "easeOut" as const },
  }[motionPreset];

  const lyricTransition = {
    soft: { duration: 0.46 * Math.max(0.85, motionIntensity), ease: [0.22, 1, 0.36, 1] as const },
    cinematic: { duration: 0.58 * Math.max(0.85, motionIntensity), ease: [0.16, 1, 0.3, 1] as const },
    minimal: { duration: 0.24 * Math.max(0.85, motionIntensity), ease: [0.22, 1, 0.36, 1] as const },
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

      <div className="chrome-actions" aria-hidden="true">
        <X strokeWidth={2.6} />
        <MoreVertical />
      </div>

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

        <div className="track-panel" style={{ padding: "1.2% 2.5% 0 3.6%" }}>
          <motion.div
            className="track-heading"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, ...transition }}
          >
            <h2
              style={{
                maxWidth: "100%",
                paddingRight: "2%",
                fontSize: "clamp(22px, 3.65vw, 64px)",
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
                paddingRight: "2%",
                whiteSpace: "normal",
                overflow: "visible",
                textOverflow: "clip",
              }}
            >
              {artist || "Unknown Artist"}
            </p>
          </motion.div>

          <div className="lyrics-stage" aria-live="polite">
            <div className="lyrics-stack lyrics-stack--carousel">
              <AnimatePresence initial={false}>
                {indexes.length ? (
                  indexes.map((lineIndex) => {
                    const line = lyrics[lineIndex];
                    const relative = lineIndex - focusIndex;
                    const distance = Math.abs(relative);
                    const isActive = relative === 0;
                    const targetOpacity = isActive ? 1 : distance === 1 ? 0.46 : 0;
                    const targetScale = isActive ? 1.055 : 0.985;
                    const rowGap = 3.85;
                    const lengthClass = lyricLengthClass(line.text);

                    return (
                      <motion.div
                        className="lyric-row"
                        key={`${line.time}-${lineIndex}`}
                        initial={{ opacity: 0, y: `${(relative + 0.25) * rowGap}cqw` }}
                        animate={{ opacity: targetOpacity, y: `${relative * rowGap}cqw` }}
                        exit={{ opacity: 0, y: `${relative < 0 ? -2.2 * rowGap : 2.2 * rowGap}cqw` }}
                        transition={lyricTransition}
                        aria-hidden={distance >= 2}
                      >
                        <div className="lyric-row-inner">
                          <motion.div
                            className="lyric-row-scale"
                            animate={{ scale: targetScale }}
                            transition={lyricTransition}
                          >
                            <div className={`lyric-line ${isActive ? "lyric-line--active" : ""} ${lengthClass}`.trim()}>
                              {line.text || " "}
                            </div>
                          </motion.div>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <motion.div
                    key="empty-lyrics"
                    className="lyric-row lyric-row--empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={lyricTransition}
                  >
                    <div className="lyric-row-inner">
                      <div className="lyric-line lyric-line--empty">가사를 입력하면 여기에 표시됩니다.</div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
