"use client";

import { useEffect, useState } from "react";
import { fmtInt, type Cluster } from "./format";

type Props = {
  clusters: Cluster[];
  firesCount: number;
  range: string;
  refreshAt: number;
  onRange: (r: string) => void;
  onStats: () => void;
};

export default function Header({ clusters, firesCount, range, refreshAt, onRange, onStats }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const left = Math.max(0, refreshAt - now.getTime());
  // le moderate conique force un repaint : granularité 15 s
  const frac = 1 - Math.ceil(left / 15000) * 15000 / 3600000;

  return (
    <header>
      <div className="brand"><span className="flame">▲</span> FRANCE FIRES</div>
      <div className="live"><span className="dot" />LIVE</div>
      <div className="kpis">
        <Kpi v={fmtInt(clusters.length)} l="Fire clusters" />
        <Kpi v={fmtInt(clusters.filter((c) => c.active).length)} l="Active" />
        <Kpi v={fmtInt(firesCount)} l="Detections" />
        <Kpi v={`${fmtInt(Math.round(clusters.reduce((s, c) => s + c.frp, 0)))} MW`} l="Total FRP" />
        <Kpi v={`${fmtInt(Math.round(clusters.reduce((s, c) => s + c.area_km2, 0)))} km²`} l="Est. footprint" />
      </div>
      <div className="spacer" />
      <div className="ranges">
        {["24h", "48h", "7d"].map((r) => (
          <button key={r} className={range === r ? "active" : ""} onClick={() => onRange(r)}>
            {r === "7d" ? "7D" : r.toUpperCase()}
          </button>
        ))}
      </div>
      <button className="hbtn" onClick={onStats}>STATS</button>
      <div className="clock">
        <b>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" })}</b> PARIS<br />
        <span>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</span> UTC
      </div>
      <div id="countdown" title="Next automatic refresh"
        style={{ background: `conic-gradient(var(--cyan) ${Math.max(0, frac) * 360}deg, var(--line) 0deg)` }}>
        <span>{Math.ceil(left / 60000)}m</span>
      </div>
    </header>
  );
}

function Kpi({ v, l }: { v: string; l: string }) {
  return (
    <div className="kpi"><span className="v">{v}</span><span className="l">{l}</span></div>
  );
}
