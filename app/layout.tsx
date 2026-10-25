import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trellis Forge — NVIDIA NIM 3D Asset Studio",
  description:
    "Turn a sentence or a photo into a textured, game-ready GLB 3D model with Microsoft TRELLIS on NVIDIA NIM. Free hosted models, deployable to Vercel in one click.",
  applicationName: "Trellis Forge",
  keywords: [
    "NVIDIA NIM",
    "TRELLIS",
    "text to 3D",
    "image to 3D",
    "3D generation",
    "GLB",
    "Vercel",
    "FLUX",
  ],
  authors: [{ name: "Trellis Forge" }],
  openGraph: {
    title: "Trellis Forge — NVIDIA NIM 3D Asset Studio",
    description:
      "Prompt → concept render → textured 3D mesh. Powered by Microsoft TRELLIS & FLUX on NVIDIA NIM.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#04060a",
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="relative min-h-screen antialiased">
        <div className="aurora" aria-hidden />
        <div className="grain" aria-hidden />
        <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
