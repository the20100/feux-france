import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEUX FRANCE",
  description:
    "Suivi temps réel des feux de forêt en France : détection satellite, risque officiel, météo, moyens aériens, renseignement en sources ouvertes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
