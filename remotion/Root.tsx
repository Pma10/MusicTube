import { Composition } from "remotion";
import { MusicVideo } from "./MusicVideo";
import type { MusicTubeRenderProps } from "./types";

const defaultProps: MusicTubeRenderProps = {
  title: "Nostalgia",
  artist: "BIG Naughty",
  channel: "1H KPOP",
  lyrics: "[00:02.00]MusicTube\n[00:06.00]Rendered with Remotion",
  audioPath: "",
  coverPath: null,
  durationSeconds: 180,
  motionPreset: "soft",
  motionIntensity: 1,
  theme: "warm",
};

export function RemotionRoot() {
  return (
    <Composition
      id="MusicTubeVideo"
      component={MusicVideo}
      width={1920}
      height={1080}
      fps={60}
      durationInFrames={60 * 180}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.ceil(Math.min(6 * 60 * 60, props.durationSeconds) * 60)),
        fps: 60,
      })}
    />
  );
}
