"use client";

import { useEffect, useState } from "react";
import type { Cluster } from "../format";

export default function ClimatBlock({ c }: { c: Cluster }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    let alive = true;
    fetch(`/api/climate?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json())
      .then((x) => alive && setD(x)).catch(() => alive && setD({ error: "x" }));
    return () => { alive = false; };
  }, [c.id]);

  if (!d) return <div id="climat"><div className="loading-bar" /></div>;
  if (d.error) return <div id="climat"><div className="intel-msg">Climate data unavailable.</div></div>;

  const mois = new Date().toLocaleDateString("en-GB", { month: "long" });
  return (
    <div id="climat">
      <div className="climat-bars">
        <Bar label={`${mois} rainfall`} cur={d.month.current} normal={d.month.normal} />
        <Bar label="March → June rainfall (recharge)" cur={d.spring.current} normal={d.spring.normal} />
      </div>
      <div style={{ marginTop: 6, fontSize: 9.5, color: "var(--dim)" }}>
        1991–2020 normals (ERA5) at the fire location · cyan line = normal
      </div>
    </div>
  );
}

function Bar({ label, cur, normal }: { label: string; cur: number; normal: number }) {
  const pct = normal > 0 ? Math.round((100 * (cur - normal)) / normal) : 0;
  const w = Math.min(100, Math.round((100 * cur) / Math.max(normal * 1.6, 1)));
  const nx = Math.min(96, Math.round(100 / 1.6));
  return (
    <div className="cb-row">
      <div className="cb-l">
        <span>{label}</span>
        <span>
          <b style={{ color: pct < -30 ? "var(--red)" : pct < 0 ? "var(--fire2)" : "var(--green)" }}>
            {cur} mm</b>{" "}
          <span style={{ color: "var(--dim)" }}>/ normal {normal} mm ({pct >= 0 ? "+" : ""}{pct}%)</span>
        </span>
      </div>
      <div className="cb-track">
        <div className="cb-fill" style={{ width: `${w}%` }} />
        <div className="cb-norm" style={{ left: `${nx}%` }} />
      </div>
    </div>
  );
}
