import type { Metadata } from "next";
import "./globals.css";
import "./render.css";

export const metadata: Metadata = {
  title: "MusicTube Studio",
  description: "Create smooth, YouTube-ready music visuals from audio, artwork and synced lyrics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
