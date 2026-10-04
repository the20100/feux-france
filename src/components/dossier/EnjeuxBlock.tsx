"use client";

import { useEffect, useState } from "react";
import { fmtInt, type Cluster } from "../format";

export default function EnjeuxBlock({ c }: { c: Cluster }) {
  const [expo, setExpo] = useState<any>(null);
  const [infra, setInfra] = useState<any>(null);

  useEffect(() => {
    setExpo(null); setInfra(null);
    let alive = true;
    fetch(`/api/exposure?lat=${c.lat}&lon=${c.lon}&r=10`).then((r) => r.json())
      .then((d) => alive && setExpo(d)).catch(() => alive && setExpo({ error: "x" }));
    fetch(`/api/infra?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json())
      .then((d) => alive && setInfra(d)).catch(() => alive && setInfra({ error: "x" }));
    return () => { alive = false; };
  }, [c.id]);

  if (!expo) return <div id="enjeux"><div className="loading-bar" /></div>;
  if (expo.error) return <div id="enjeux"><div className="intel-msg">Exposure data unavailable.</div></div>;

  return (
    <div id="enjeux">
      <div className="expo-head">
        <b>{fmtInt(expo.total_pop)}</b> residents · <b>{expo.n_communes}</b> {expo.n_communes > 1 ? "municipalities" : "municipality"} within 10 km
      </div>
      {expo.communes.slice(0, 5).map((x: any, i: number) => (
        <div key={i} className="mini-row">
          <span>{x.nom} <span className="k">({x.dept})</span></span>
          <span className="k">{fmtInt(x.population)} residents · {x.dist_km} km</span>
        </div>
      ))}
      {infra?.error && (
        <div className="intel-msg">Infrastructure: source unavailable.</div>
      )}
      {infra?.items?.length > 0 && (
        <>
          <div style={{ marginTop: 9, fontSize: 9, letterSpacing: ".12em", color: "var(--muted)" }}>
            SENSITIVE SITES WITHIN 3 KM (OSM)
          </div>
          {infra.items.slice(0, 8).map((x: any, i: number) => (
            <div key={i} className="mini-row">
              <span><span className="infra-kind">{x.kind}</span> {x.name}</span>
              <span className="k">{x.dist_km} km</span>
            </div>
          ))}
        </>
      )}
      {infra && !infra.error && !infra.items?.length && (
        <div className="intel-msg" style={{ padding: "8px 0 0" }}>
          No sensitive sites recorded within 3 km.
        </div>
      )}
    </div>
  );
}
