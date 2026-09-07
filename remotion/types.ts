export type RenderMotionPreset = "soft" | "cinematic" | "minimal";
export type RenderThemePreset = "warm" | "cool" | "mono";

export type MusicTubeRenderProps = {
  title: string;
  artist: string;
  channel: string;
  lyrics: string;
  audioPath: string;
  coverPath: string | null;
  durationSeconds: number;
  motionPreset: RenderMotionPreset;
  motionIntensity: number;
  theme: RenderThemePreset;
};
