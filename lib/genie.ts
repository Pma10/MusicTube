// Native Node.js port of the scraping logic used by Pma10/GenieAPI.
// Keeping the integration in-process means MusicTube no longer needs a Python bridge.

export type GenieSong = {
  id: string;
  title: string;
  artist: string;
  album: string;
  album_id: string;
  thumbnail_url: string;
  duration?: string | null;
  genre?: string | null;
  release_date?: string | null;
  lyricist?: string | null;
  composer?: string | null;
  arranger?: string | null;
};

const GENIE_BASE_URL = "https://www.genie.co.kr";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const searchCache = new Map<string, { expiresAt: number; value: GenieSong[] }>();
const songCache = new Map<string, { expiresAt: number; value: GenieSong | null }>();
const lyricCache = new Map<string, { expiresAt: number; value: string }>();

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function stripTags(value: string) {
  return decodeHtml(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag: string | null, name: string) {
  if (!tag) return "";
  const escaped = escapeRegex(name);
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function findTagByClass(html: string, tag: string, className: string) {
  const escapedTag = escapeRegex(tag);
  const escapedClass = escapeRegex(className);
  const regex = new RegExp(
    `<${escapedTag}\\b[^>]*class\\s*=\\s*(["'])[^"']*\\b${escapedClass}\\b[^"']*\\1[^>]*>[\\s\\S]*?<\\/${escapedTag}>`,
    "i",
  );
  return html.match(regex)?.[0] ?? null;
}

function findFirstTag(html: string, tag: string) {
  const escapedTag = escapeRegex(tag);
  return html.match(new RegExp(`<${escapedTag}\\b[^>]*>[\\s\\S]*?<\\/${escapedTag}>`, "i"))?.[0] ?? null;
}

function innerHtml(tag: string | null) {
  if (!tag) return "";
  const start = tag.indexOf(">");
  const end = tag.lastIndexOf("<");
  return start >= 0 && end > start ? tag.slice(start + 1, end) : "";
}

function directText(tag: string | null) {
  const inner = innerHtml(tag);
  if (!inner) return "";
  const firstMarkup = inner.indexOf("<");
  const direct = decodeHtml(firstMarkup >= 0 ? inner.slice(0, firstMarkup) : inner)
    .replace(/\s+/g, " ")
    .trim();
  return direct || stripTags(inner);
}

function normalizeImageUrl(value: string) {
  let url = decodeHtml(value).trim();
  if (!url) return "";

  if (url.startsWith("https:https://")) url = url.replace("https:https://", "https://");
  else if (url.startsWith("https:https:")) url = url.replace("https:https:", "https:");
  else if (url.startsWith("//")) url = `https:${url}`;
  else if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;

  return url.split("/dims/")[0];
}

async function fetchText(url: URL | string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Genie request failed (${response.status})`);
  }

  return response.text();
}

function parseSongRow(row: string): GenieSong | null {
  const opening = row.match(/^<tr\b[^>]*>/i)?.[0] ?? null;
  const id = getAttribute(opening, "songid");
  if (!/^\d+$/.test(id)) return null;

  const info = findTagByClass(row, "td", "info") ?? row;
  const titleTag = findTagByClass(info, "a", "title");
  const artistTag = findTagByClass(info, "a", "artist");
  const albumTag = findTagByClass(info, "a", "albumtitle");

  let title = getAttribute(titleTag, "title") || stripTags(innerHtml(titleTag));
  if (title === "재생") title = "";
  const artist = getAttribute(artistTag, "title") || stripTags(innerHtml(artistTag));
  const album = getAttribute(albumTag, "title") || stripTags(innerHtml(albumTag));

  const onclick = getAttribute(albumTag, "onclick");
  const albumId =
    onclick.match(/fnViewAlbumLayer\(['"]?(\d+)['"]?\)/i)?.[1] ??
    onclick.match(/fnGoMore\(['"]albumInfo['"],['"](\d+)['"]\)/i)?.[1] ??
    "";

  const coverTag = findTagByClass(row, "a", "cover");
  const imageTag = coverTag?.match(/<img\b[^>]*>/i)?.[0] ?? null;
  const thumbnailUrl = normalizeImageUrl(getAttribute(imageTag, "src"));

  return {
    id,
    title,
    artist,
    album,
    album_id: albumId,
    thumbnail_url: thumbnailUrl,
  };
}

function parseSearchRows(html: string, limit: number) {
  const rows = html.match(/<tr\b[^>]*class\s*=\s*(["'])[^"']*\blist\b[^"']*\1[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const songs: GenieSong[] = [];

  for (const row of rows) {
    const parsed = parseSongRow(row);
    if (parsed) songs.push(parsed);
    if (songs.length >= limit) break;
  }

  return songs;
}

function parseSongDetail(html: string, songId: string): GenieSong | null {
  const marker = html.search(/song-main-infos|info-zone/i);
  if (marker < 0) return null;
  const area = html.slice(marker, marker + 60_000);

  const titleTag = findFirstTag(area, "h2");
  const artistTag = findTagByClass(area, "h3", "artist") ?? findTagByClass(area, "div", "artist");

  const title = directText(titleTag);
  const artist = stripTags(innerHtml(artistTag));

  let duration = "";
  let genre = "";
  let lyricist = "";
  let composer = "";
  let arranger = "";

  const listItems = area.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  for (const item of listItems) {
    const attr = findTagByClass(item, "span", "attr");
    const type = findTagByClass(item, "span", "type");
    const value = findTagByClass(item, "span", "value");
    const attrImage = attr?.match(/<img\b[^>]*>/i)?.[0] ?? null;
    const key = getAttribute(attrImage, "alt") || stripTags(innerHtml(attr)) || stripTags(innerHtml(type));
    const text = stripTags(innerHtml(value));
    if (!key || !text) continue;

    if (key.includes("장르")) genre = text;
    else if (key.includes("재생시간")) duration = text;
    else if (key.includes("작사가")) lyricist = text;
    else if (key.includes("작곡가")) composer = text;
    else if (key.includes("편곡자")) arranger = text;
  }

  const photoMarker = html.search(/photo-zone/i);
  const photoArea = photoMarker >= 0 ? html.slice(photoMarker, photoMarker + 12_000) : "";
  const imageTag = photoArea.match(/<img\b[^>]*>/i)?.[0] ?? null;
  const thumbnailUrl = normalizeImageUrl(getAttribute(imageTag, "src"));

  if (!title && !artist) return null;

  return {
    id: songId,
    title,
    artist,
    album: "",
    album_id: "",
    thumbnail_url: thumbnailUrl,
    duration: duration || null,
    genre: genre || null,
    lyricist: lyricist || null,
    composer: composer || null,
    arranger: arranger || null,
  };
}

function lyricsJsonToLrc(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";

  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([time, lyric]) => [Number.parseInt(time, 10), String(lyric ?? "")] as const)
    .filter(([time]) => Number.isFinite(time))
    .sort(([a], [b]) => a - b);

  return entries
    .map(([timeMs, lyric]) => {
      const minutes = Math.floor(timeMs / 60_000);
      const seconds = Math.floor((timeMs % 60_000) / 1_000);
      const hundredths = Math.floor((timeMs % 1_000) / 10);
      return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}] ${lyric}`;
    })
    .join("\n");
}

export function genieSongUrl(songId: string) {
  return `${GENIE_BASE_URL}/detail/songInfo?xgnm=${encodeURIComponent(songId)}`;
}

export async function searchGenieSongs(query: string, limit = 8) {
  const normalizedQuery = query.trim();
  const normalizedLimit = Math.max(1, Math.min(20, Math.trunc(limit) || 8));
  const cacheKey = `${normalizedQuery.toLowerCase()}::${normalizedLimit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("/search/searchMain", GENIE_BASE_URL);
  url.searchParams.set("query", normalizedQuery);
  const html = await fetchText(url);
  const songs = parseSearchRows(html, normalizedLimit);

  searchCache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: songs });
  return songs;
}

export async function getGenieSongDetail(songId: string) {
  const cached = songCache.get(songId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("/detail/songInfo", GENIE_BASE_URL);
  url.searchParams.set("xgnm", songId);
  const html = await fetchText(url);
  const song = parseSongDetail(html, songId);

  songCache.set(songId, { expiresAt: Date.now() + 5 * 60_000, value: song });
  return song;
}

export async function getGenieLyrics(songId: string) {
  const cached = lyricCache.get(songId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("https://dn.genie.co.kr/app/purchase/get_msl.asp");
  url.searchParams.set("path", "a");
  url.searchParams.set("songid", songId);

  const content = await fetchText(url);
  const open = content.indexOf("(");
  const close = content.lastIndexOf(")");
  if (open < 0 || close <= open) throw new Error("Genie lyric response is not valid JSONP");

  const parsed = JSON.parse(content.slice(open + 1, close)) as unknown;
  const lrc = lyricsJsonToLrc(parsed);
  lyricCache.set(songId, { expiresAt: Date.now() + 10 * 60_000, value: lrc });
  return lrc;
}
