import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./omni.css";
import PlatformNav from "@/components/omni/PlatformNav";

export const metadata: Metadata = {
  title: "OMNI — Global Observatory",
  description:
    "Fires, health surveillance and conflicts: maps, timelines and verifiable sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><PlatformNav/><main className="omni-content">{children}</main></body>
    </html>
  );
}
