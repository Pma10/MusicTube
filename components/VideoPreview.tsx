"use client";

import { AnimatePresence, motion } from "framer-motion";
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
  channel: string;
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
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function VideoPreview({
  title,
  artist,
  channel,
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
  const activeIndex = findActiveLyricIndex(lyrics, currentTime);
  const visibleLyrics = activeIndex < 0 ? lyrics.slice(0, 3) : lyrics.slice(activeIndex, activeIndex + 3);
  const activeKey = activeIndex < 0 ? "intro" : `${activeIndex}-${lyrics[activeIndex]?.text ?? ""}`;

  const transition = {
    soft: { duration: 0.52 * motionIntensity, ease: [0.22, 1, 0.36, 1] as const },
    cinematic: { duration: 0.78 * motionIntensity, ease: [0.16, 1, 0.3, 1] as const },
    minimal: { duration: 0.3 * motionIntensity, ease: "easeOut" as const },
  }[motionPreset];

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <section className={`video-shell theme-${theme}`}>
      <div
        className={`ambient-bg ${isPlaying ? "ambient-bg--playing" : ""}`}
        style={{
          backgroundImage: coverUrl ? `url(${coverUrl})` : themeFallback[theme],
        }}
      />
      <div className="ambient-wash" />
      <div className="video-noise" />

      <motion.div
        className="brand-mark"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, ...transition }}
      >
        <strong>{channel || "MUSICTUBE"}</strong>
        <span className="brand-orbit">PLAYING · MUSIC · LOOP ·</span>
      </motion.div>

      <div className="chrome-actions" aria-hidden="true">
        <X strokeWidth={2.8} />
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
                    scale: motionPreset === "minimal" ? 1 : [1, 1.018, 1],
                    rotate: motionPreset === "cinematic" ? [0, 0.18, 0] : 0,
                  }
                : { scale: 1, rotate: 0 }
            }
            transition={{ duration: 12 / Math.max(0.7, motionIntensity), repeat: Infinity, ease: "easeInOut" }}
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
          </motion.div>
        </motion.div>

        <div className="track-panel">
          <motion.div
            className="track-heading"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, ...transition }}
          >
            <h2>{title || "Untitled"}</h2>
            <p>{artist || "Unknown Artist"}</p>
          </motion.div>

          <div className="lyrics-stage" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeKey}
                className="lyrics-stack"
                initial={{ opacity: 0, y: 16 * motionIntensity, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -12 * motionIntensity, filter: "blur(4px)" }}
                transition={transition}
              >
                {visibleLyrics.length ? (
                  visibleLyrics.map((line, index) => (
                    <div
                      className={`lyric-line ${index === 0 && activeIndex >= 0 ? "lyric-line--active" : ""}`}
                      key={`${line.time}-${line.text}`}
                    >
                      {line.text}
                    </div>
                  ))
                ) : (
                  <div className="lyric-line lyric-line--empty">가사를 입력하면 여기에 표시됩니다.</div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="player-area">
            <div className="player-controls">
              <button className="ghost-control" type="button" aria-label="Like preview">
                <Heart />
              </button>
              <button className="ghost-control" type="button" aria-label="Previous preview">
                <SkipBack fill="currentColor" />
              </button>
              <motion.button
                className="main-play"
                type="button"
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
                onClick={onTogglePlay}
                whileTap={{ scale: 0.92 }}
              >
                {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </motion.button>
              <button className="ghost-control" type="button" aria-label="Next preview">
                <SkipForward fill="currentColor" />
              </button>
              <button className="ghost-control" type="button" aria-label="Favorite preview">
                <Heart />
              </button>
            </div>

            <div className="timeline-row">
              <span>{formatTime(currentTime)}</span>
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
                <span className="timeline-fill" style={{ transform: `scaleX(${progress})` }} />
              </button>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
