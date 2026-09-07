"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import styles from "./GenieSearch.module.css";

export type GenieSong = {
  id: string;
  title: string;
  artist: string;
  album: string;
  album_id: string;
  thumbnail_url: string;
  duration?: string | null;
  genre?: string | null;
};

export type GenieSelection = {
  song: GenieSong;
  lrc: string;
  source: {
    provider: string;
    song_id: string;
    url: string;
  };
};

type GenieSearchProps = {
  onApply: (selection: GenieSelection) => void;
};

export function GenieSearch({ onApply }: GenieSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GenieSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
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
        const response = await fetch(`/api/genie/search?q=${encodeURIComponent(cleanQuery)}&limit=8`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "검색에 실패했습니다.");
        if (active) setResults(payload.songs ?? []);
      } catch (searchError) {
        if (!active || controller.signal.aborted) return;
        setResults([]);
        setError(searchError instanceof Error ? searchError.message : "검색에 실패했습니다.");
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

  const applySong = async (song: GenieSong) => {
    setApplyingId(song.id);
    setError(null);

    try {
      const response = await fetch(`/api/genie/song/${song.id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "곡 정보를 불러오지 못했습니다.");

      const selection = payload as GenieSelection;
      selection.song = {
        ...song,
        ...selection.song,
        album: selection.song.album || song.album,
        album_id: selection.song.album_id || song.album_id,
        thumbnail_url: selection.song.thumbnail_url || song.thumbnail_url,
      };
      onApply(selection);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "곡 정보를 불러오지 못했습니다.");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.searchBox}>
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="곡명 또는 아티스트 검색"
          aria-label="Genie 곡 검색"
        />
        {loading ? <LoaderCircle className={styles.spinner} size={15} aria-label="검색 중" /> : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {results.length > 0 ? (
        <div className={styles.results}>
          {results.map((song) => (
            <button
              className={styles.result}
              type="button"
              key={song.id}
              onClick={() => applySong(song)}
              disabled={applyingId !== null}
            >
              <span className={styles.cover}>
                {song.thumbnail_url ? <img src={song.thumbnail_url} alt="" /> : <span>♪</span>}
              </span>
              <span className={styles.meta}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>{song.album || `Genie #${song.id}`}</small>
              </span>
              <span className={styles.apply}>
                {applyingId === song.id ? <LoaderCircle className={styles.spinner} size={14} /> : "불러오기"}
              </span>
            </button>
          ))}
        </div>
      ) : query.trim().length >= 2 && !loading && !error ? (
        <div className={styles.empty}>검색 결과가 없습니다.</div>
      ) : null}

      <p className={styles.note}>GenieAPI는 제목 · 아티스트 · 앨범아트 · 타임싱크 가사를 채웁니다. 음원은 연결된 자동 소스가 있으면 함께 가져오고, 없으면 URL이나 파일 첨부를 사용할 수 있습니다.</p>
    </div>
  );
}
