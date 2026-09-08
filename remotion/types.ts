export type RenderMotionPreset = "soft" | "cinematic" | "minimal";
export type RenderThemePreset = "warm" | "cool" | "mono";
export type RenderProfile = "fast" | "quality";

export type MusicTubeRenderProps = {
  title: string;
  artist: string;
  lyrics: string;
  audioPath: string;
  coverPath: string | null;
  durationSeconds: number;
  motionPreset: RenderMotionPreset;
  motionIntensity: number;
  theme: RenderThemePreset;
  renderProfile: RenderProfile;
};
