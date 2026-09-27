"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, LoaderCircle, Search } from "lucide-react";
import styles from "./YouTubeMusicSearch.module.css";

export type YouTubeMusicVideo = {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  musicUrl: string;
};

type YouTubeMusicSearchProps = {
  onImport: (video: YouTubeMusicVideo) => void;
  selectedVideoId: string | null;
  importingVideoId: string | null;
};

export function YouTubeMusicSearch({ onImport, selectedVideoId, importingVideoId }: YouTubeMusicSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeMusicVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(cleanQuery)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { videos?: YouTubeMusicVideo[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "YouTube 검색에 실패했습니다.");
        if (active) setResults(payload.videos ?? []);
      } catch (searchError) {
        if (!active || controller.signal.aborted) return;
        setResults([]);
        setError(searchError instanceof TypeError
          ? "검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."
          : searchError instanceof Error
            ? searchError.message
            : "검색에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        if (active) setLoading(false);
      }
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.searchBox}>
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="곡명 또는 아티스트 검색"
          aria-label="YouTube Music 곡 검색"
        />
        {loading ? <LoaderCircle className={styles.spinner} size={15} aria-label="검색 중" /> : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {results.length > 0 ? (
        <div className={styles.results}>
          {results.map((video) => (
            <div className={`${styles.result} ${video.videoId === selectedVideoId ? styles.selected : ""} ${video.videoId === importingVideoId ? styles.importing : ""}`} key={video.videoId}>
              <button className={styles.selectButton} type="button" onClick={() => onImport(video)} disabled={importingVideoId !== null} aria-label={`${video.title} 불러오기`}>
                <span className={styles.cover}>
                  {video.thumbnailUrl ? <Image src={video.thumbnailUrl} width={84} height={84} alt="" unoptimized loading="lazy" referrerPolicy="no-referrer" /> : <span>♪</span>}
                </span>
                <span className={styles.meta}>
                  <strong>{video.title}</strong>
                  <span>{video.artist}</span>
                  <small>YouTube Music 검색 결과</small>
                </span>
              </button>
              <a className={styles.openLink} href={video.musicUrl} target="_blank" rel="noreferrer" aria-label={`${video.title} YouTube Music에서 열기`} title="YouTube Music에서 열기">
                <ExternalLink size={14} />
              </a>
            </div>
          ))}
        </div>
      ) : query.trim().length >= 2 && !loading && !error ? (
        <div className={styles.empty}>검색 결과가 없습니다.</div>
      ) : null}

    </div>
  );
}
