export type LyricLine = {
  time: number;
  text: string;
};

const TIMESTAMP = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
const META_TAG = /^\[(ar|ti|al|by|offset|re|ve):/i;

export function parseLyrics(input: string): LyricLine[] {
  const rows = input.replace(/\r/g, "").split("\n");
  const timed: LyricLine[] = [];

  for (const row of rows) {
    if (!row.trim() || META_TAG.test(row.trim())) continue;

    const tags = [...row.matchAll(TIMESTAMP)];
    if (!tags.length) continue;

    const text = row.replace(TIMESTAMP, "").trim();
    if (!text) continue;

    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      timed.push({ time: minutes * 60 + seconds, text });
    }
  }

  if (timed.length) {
    return timed.sort((a, b) => a.time - b.time);
  }

  return rows
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      time: 2 + index * 4.2,
      text,
    }));
}

export function findActiveLyricIndex(lines: LyricLine[], currentTime: number) {
  if (!lines.length) return -1;

  let low = 0;
  let high = lines.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= currentTime) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}
