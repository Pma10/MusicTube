export type ProjectMotionPreset = "soft" | "cinematic" | "minimal";
export type ProjectThemePreset = "warm" | "cool" | "mono";
export type ProjectRenderResolution = "720p" | "1080p" | "1440p" | "4k";
export type ProjectRenderProfile = "fast" | "quality";
export type ProjectAudioOrigin = "attachment" | "url" | "resolver" | "youtube" | null;

export type MusicTubeProject = {
  version: 2;
  savedAt: string;
  metadata: {
    title: string;
    artist: string;
  };
  lyrics: string;
  appearance: {
    theme: ProjectThemePreset;
    motionPreset: ProjectMotionPreset;
    motionIntensity: number;
  };
  render: {
    resolution: ProjectRenderResolution;
    profile: ProjectRenderProfile;
  };
  media: {
    audioName: string | null;
    audioOrigin: ProjectAudioOrigin;
    audioImportUrl: string | null;
    youtubeVideoId: string | null;
    coverName: string | null;
    coverUrl: string | null;
    duration: number | null;
  };
  source: {
    provider: "Genie";
    songId: string;
  } | null;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown, fallback = "", maxLength = 250_000) {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function nullableString(value: unknown, maxLength = 2_000) {
  const text = stringValue(value, "", maxLength).trim();
  return text || null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function audioOrigin(value: unknown): ProjectAudioOrigin {
  return value === "attachment" || value === "url" || value === "resolver" || value === "youtube" ? value : null;
}

function finiteNumber(value: unknown, fallback: number | null, min: number, max: number) {
  if (value === null || value === undefined) return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeHttpsUrl(value: unknown) {
  const raw = nullableString(value, 4_096);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseMusicTubeProject(input: unknown): MusicTubeProject {
  const root = record(input);
  const version = Number(root.version ?? 1);
  if (!Number.isInteger(version) || version < 1 || version > 2) {
    throw new Error("지원하지 않는 MusicTube 프로젝트 버전입니다.");
  }

  const metadata = record(root.metadata);
  const appearance = record(root.appearance);
  const render = record(root.render);
  const media = record(root.media);
  const source = record(root.source);

  const sourceProvider = stringValue(source.provider, "", 32);
  const sourceSongId = stringValue(source.songId, "", 64);

  return {
    version: 2,
    savedAt: stringValue(root.savedAt, new Date().toISOString(), 64),
    metadata: {
      title: stringValue(metadata.title, "Nostalgia", 160),
      artist: stringValue(metadata.artist, "BIG Naughty (서동현)", 160),
    },
    lyrics: stringValue(root.lyrics, "", 250_000),
    appearance: {
      theme: enumValue(appearance.theme, ["warm", "cool", "mono"] as const, "warm"),
      motionPreset: enumValue(
        appearance.motionPreset,
        ["soft", "cinematic", "minimal"] as const,
        "soft",
      ),
      motionIntensity: finiteNumber(appearance.motionIntensity, 1, 0.6, 1.4) ?? 1,
    },
    render: {
      resolution: enumValue(render.resolution, ["720p", "1080p", "1440p", "4k"] as const, "1080p"),
      profile: enumValue(render.profile, ["fast", "quality"] as const, "fast"),
    },
    media: {
      audioName: nullableString(media.audioName, 255),
      audioOrigin: audioOrigin(media.audioOrigin),
      audioImportUrl: safeHttpsUrl(media.audioImportUrl),
      youtubeVideoId: /^[\w-]{11}$/.test(stringValue(media.youtubeVideoId, "", 32))
        ? stringValue(media.youtubeVideoId, "", 32)
        : null,
      coverName: nullableString(media.coverName, 255),
      coverUrl: safeHttpsUrl(media.coverUrl),
      duration: finiteNumber(media.duration, null, 0.1, 6 * 60 * 60),
    },
    source:
      sourceProvider === "Genie" && /^\d+$/.test(sourceSongId)
        ? { provider: "Genie", songId: sourceSongId }
        : null,
  };
}

export function serializeMusicTubeProject(project: MusicTubeProject) {
  return JSON.stringify(project, null, 2);
}
