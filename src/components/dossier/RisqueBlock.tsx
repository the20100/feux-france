"use client";

import { DANGER_LABELS, type Cluster } from "../format";

export default function RisqueBlock({ c, season }: { c: Cluster; season?: boolean }) {
  const phen = (c.vig?.phen || []).filter((p: any) => p.level >= 2);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div id="risque">
      {season && c.danger_j1 ? (
        <div className="dgr-row">
          <div className="dgr">
            <div className={`v dgr${c.danger_j1}`}>● {DANGER_LABELS[c.danger_j1]} ({c.danger_j1}/4)</div>
            <div className="l">Danger feux demain</div>
          </div>
          <div className="dgr">
            <div className={`v dgr${c.danger_j2 || 1}`}>
              ● {c.danger_j2 ? `${DANGER_LABELS[c.danger_j2]} (${c.danger_j2}/4)` : "n.d."}
            </div>
            <div className="l">Après-demain</div>
          </div>
        </div>
      ) : season === false ? (
        <div className="intel-msg" style={{ padding: "4px 0" }}>
          Météo des forêts hors saison (juin-septembre).
        </div>
      ) : null}
      {phen.length ? (
        <div className="vig-chips">
          {phen.map((p: any, i: number) => (
            <span key={i} className="vig-chip">
              <span className={`vd vig-${p.level}`} />
              {p.name} ({p.echeance})
              {p.peak ? ` · pic ${fmt(p.peak.from)}–${fmt(p.peak.to)}` : ""}
            </span>
          ))}
        </div>
      ) : c.vig ? (
        <div className="intel-msg" style={{ padding: "4px 0" }}>
          Aucune vigilance en cours sur le département.
        </div>
      ) : null}
      {c.vig?.cocktail && (
        <div className="cocktail-banner">
          ⚠ COCKTAIL À RISQUE : vigilances vent violent + canicule simultanées
        </div>
      )}
      {c.vig?.orage && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--yellow)" }}>
          ⚡ Vigilance orages — risque de nouveaux départs de feu (foudre)
        </div>
      )}
    </div>
  );
}
