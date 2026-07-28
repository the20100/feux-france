"use client";

import { useMemo, useState } from "react";
import { fmtAgo, frpLabel, scoreClass, VIG_COLORS, DANGER_LABELS, type Cluster } from "./format";

type Props = {
  clusters: Cluster[];
  selectedId: string | null;
  onSelect: (c: Cluster) => void;
  search: string;
  onSearch: (q: string) => void;
};

export default function Sidebar({ clusters, selectedId, onSelect, search, onSearch }: Props) {
  const [sort, setSort] = useState<"score" | "frp">("score");

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const sorted = [...clusters].sort((a, b) =>
      sort === "score"
        ? (b.score ?? -1) - (a.score ?? -1) || b.frp - a.frp
        : b.frp - a.frp);
    return sorted
      .filter((c) => !q ||
        `${c.name} ${c.dept_name || ""} ${c.dept || ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [clusters, sort, search]);

  const maxFrp = Math.max(...clusters.map((c) => c.frp), 1);

  return (
    <aside id="sidebar">
      <div className="head">
        <div className="title">Foyers détectés</div>
        <input id="search" placeholder="Filtrer par commune, département…"
          value={search} onChange={(e) => onSearch(e.target.value)} />
        <div className="sorttog">
          <button className={sort === "score" ? "active" : ""} onClick={() => setSort("score")}>⚠ MENACE</button>
          <button className={sort === "frp" ? "active" : ""} onClick={() => setSort("frp")}>🔥 INTENSITÉ</button>
        </div>
      </div>
      <div id="firelist">
        {rows.map((c, i) => (
          <FireRow key={c.id} c={c} rank={i + 1} maxFrp={maxFrp}
            selected={selectedId === c.id} onSelect={() => onSelect(c)} />
        ))}
      </div>
    </aside>
  );
}

function FireRow({ c, rank, maxFrp, selected, onSelect }:
  { c: Cluster; rank: number; maxFrp: number; selected: boolean; onSelect: () => void }) {
  return (
    <div className={`fire-row ${c.active ? "" : "cooling"} ${selected ? "sel" : ""}`} onClick={onSelect}>
      {c.isNew && <span className="badge-new">NOUVEAU</span>}
      <div className="r1">
        <span className="rank">{String(rank).padStart(2, "0")}</span>
        <span className="nm">{c.name}</span>
        {c.reprise && <span className="badge-reprise">⟳ REPRISE</span>}
        {(c.danger_j1 ?? 0) >= 3 && (
          <span title={`Danger feux ${DANGER_LABELS[c.danger_j1!]} demain`}
            style={{ color: VIG_COLORS[c.danger_j1!], fontSize: 10 }}>▲</span>
        )}
        {c.vig?.cocktail && <span title="Vigilances vent + canicule">⚠</span>}
        {c.dept && <span className="badge-dept">{c.dept}</span>}
        <span className={`score-pill ${scoreClass(c.score)}`} title="Score de menace">{c.score ?? "–"}</span>
        <span className="frp">{frpLabel(c.frp)}</span>
      </div>
      <div className="r2">
        <span>{c.n} détect.</span>
        <span>vu il y a {fmtAgo(c.last)}</span>
        <span className={`trend-${c.trend}`}>
          {c.trend === "up" ? "▲ intensification" : c.trend === "down" ? "▼ décroissance" : "― stable"}
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${Math.max(2, Math.round((100 * c.frp) / maxFrp))}%` }} />
      </div>
    </div>
  );
}
