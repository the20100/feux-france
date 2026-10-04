"use client";

import { DANGER_LABELS, type Cluster } from "../format";

export default function RisqueBlock({ c, season }: { c: Cluster; season?: boolean }) {
  const phen = (c.vig?.phen || []).filter((p: any) => p.level >= 2);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div id="risque">
      {season && c.danger_j1 ? (
        <div className="dgr-row">
          <div className="dgr">
            <div className={`v dgr${c.danger_j1}`}>● {DANGER_LABELS[c.danger_j1]} ({c.danger_j1}/4)</div>
            <div className="l">Fire danger tomorrow</div>
          </div>
          <div className="dgr">
            <div className={`v dgr${c.danger_j2 || 1}`}>
              ● {c.danger_j2 ? `${DANGER_LABELS[c.danger_j2]} (${c.danger_j2}/4)` : "n/a"}
            </div>
            <div className="l">Day after tomorrow</div>
          </div>
        </div>
      ) : season === false ? (
        <div className="intel-msg" style={{ padding: "4px 0" }}>
          Forest fire forecasts out of season (June–September).
        </div>
      ) : null}
      {phen.length ? (
        <div className="vig-chips">
          {phen.map((p: any, i: number) => (
            <span key={i} className="vig-chip">
              <span className={`vd vig-${p.level}`} />
              {({1:"Strong wind",2:"Rain and flooding",3:"Thunderstorms",4:"River flooding",5:"Snow and ice",6:"Heatwave",7:"Extreme cold",8:"Avalanches",9:"Coastal flooding"} as Record<string,string>)[p.id] || "Weather warning"} ({p.echeance === "J" ? "Today" : p.echeance === "J1" ? "Tomorrow" : p.echeance})
              {p.peak ? ` · peak ${fmt(p.peak.from)}–${fmt(p.peak.to)}` : ""}
            </span>
          ))}
        </div>
      ) : c.vig ? (
        <div className="intel-msg" style={{ padding: "4px 0" }}>
          No active warnings for this department.
        </div>
      ) : null}
      {c.vig?.cocktail && (
        <div className="cocktail-banner">
          ⚠ COMBINED RISK: simultaneous strong wind + heatwave warnings
        </div>
      )}
      {c.vig?.orage && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--yellow)" }}>
          ⚡ Thunderstorm warning — risk of new fires from lightning
        </div>
      )}
    </div>
  );
}
