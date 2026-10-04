"use client";

import { useEffect, useState } from "react";
import type { Cluster } from "../format";

export default function AiSummary({ c, range }: { c: Cluster; range: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    let alive = true;
    fetch(`/api/summary?id=${encodeURIComponent(c.id)}&range=${range}`)
      .then((r) => r.json()).then((x) => alive && setD(x))
      .catch(() => alive && setD({ error: "x" }));
    return () => { alive = false; };
  }, [c.id, range]);

  if (!d) return (
    <div className="ai-box"><div className="ai-t">◈ AI SUMMARY</div><div className="loading-bar" /></div>
  );
  if (d.error === "no_key") return null;
  if (d.error === "budget") return (
    <div className="ai-box">
      <div className="ai-t">◈ AI SUMMARY</div>
      <div className="intel-msg" style={{ padding: "4px 0" }}>
        {d.detail || "Daily AI budget exhausted"} — no summary archived for this fire yet.
      </div>
    </div>
  );
  if (d.error) return (
    <div className="ai-box"><div className="ai-t">◈ AI SUMMARY</div>
      <div className="intel-msg">{d.error}</div></div>
  );
  const gen = d.generated_at
    ? new Date(d.generated_at).toLocaleString("en-GB",
      { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <div className="ai-box">
      <div className="ai-t">
        ◈ AI SUMMARY{" "}
        <span style={{ color: "var(--dim)", letterSpacing: 0, fontWeight: 400 }}>
          {d.model || ""}{gen ? ` · ${gen}` : ""}
          {d.stale ? " · daily budget exhausted, latest version" : ""}
        </span>
      </div>
      <div className="ai-r">{d.resume}</div>
      {d.chiffres?.length > 0 && (
        <div className="ai-chiffres">
          {d.chiffres.map((x: any, i: number) => (
            <div key={i} className="ai-chip">
              <b>{String(x.valeur)}</b>{x.label}
              <div className="src">{x.source || ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
