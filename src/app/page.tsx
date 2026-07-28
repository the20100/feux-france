"use client";

import dynamic from "next/dynamic";

// Leaflet manipule window : tout le poste de contrôle est client-only
const WarRoom = dynamic(() => import("@/components/WarRoom"), { ssr: false });

export default function Page() {
  return <WarRoom />;
}
