"use client";

/**
 * Poste de contrôle : état global (données, sélection, plage, timeline,
 * couches) et composition de l'interface.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import Timeline, { type TlState } from "./Timeline";
import LayersPanel, { DEFAULT_LAYERS, type LayerState } from "./LayersPanel";
import Toasts, { type Toast } from "./Toasts";
import AirLegend from "./AirLegend";
import StatsModal from "./StatsModal";
import MapView from "./map/MapView";
import Dossier from "./dossier/Dossier";
import type { Cluster } from "./format";

const REFRESH_MS = 60 * 60 * 1000; // rafraîchissement automatique horaire

export default function WarRoom() {
  const [range, setRange] = useState(() => { try { const r=sessionStorage.getItem("omni-feux-range"); return ["24h","48h","7d"].includes(r || "") ? r! : "7d"; } catch { return "7d"; } });
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [fires, setFires] = useState<any[]>([]);
  const [mfForets, setMfForets] = useState<any>(null);
  const [mfVig, setMfVig] = useState<any>(null);
  const [flags, setFlags] = useState({ exa: true, openrouter: true });
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [selectedWeather, setSelectedWeather] = useState<any>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [choro, setChoro] = useState("none");
  const [tl, setTl] = useState<TlState>({ min: 0, max: 1, cursor: null, playing: false });
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [statsOpen, setStatsOpen] = useState(false);
  const [airLegend, setAirLegend] = useState(false);
  const [refreshAt, setRefreshAt] = useState(Date.now() + REFRESH_MS);
  useEffect(() => { try { sessionStorage.setItem("omni-feux-range",range); } catch {} }, [range]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const pushToast = useCallback((t: Toast) => {
    setToasts((cur) => [...cur, t]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 15000);
  }, []);

  const loadAll = useCallback(async (r: string) => {
    const [cl, fi, forets, vig] = await Promise.all([
      fetch(`/api/clusters?range=${r}`).then((x) => x.json()),
      fetch(`/api/fires?range=${r}`).then((x) => x.json()),
      fetch("/api/mf/forets").then((x) => x.json()).catch(() => null),
      fetch("/api/mf/vigilance").then((x) => x.json()).catch(() => null),
    ]);
    setMfForets(forets);
    setMfVig(vig);
    setFlags({ exa: !!cl.meta?.exa, openrouter: !!cl.meta?.openrouter });

    // alertes : nouveaux foyers, danger très élevé, cocktails
    const today = new Date().toISOString().slice(0, 10);
    try {
      const key = `feux_seen_${r}`;
      const seen = new Set<string>(JSON.parse(localStorage.getItem(key) || "[]"));
      if (seen.size) {
        cl.clusters.filter((c: Cluster) => !seen.has(c.id) && c.frp > 8).slice(0, 5)
          .forEach((c: Cluster) => {
            c.isNew = true;
            pushToast({ id: `new-${c.id}`, title: "NEW FIRE CLUSTER DETECTED",
              msg: `${c.name}${c.dept ? ` (${c.dept})` : ""} — FRP ${c.frp} MW`, clusterId: c.id });
          });
      }
      localStorage.setItem(key, JSON.stringify(cl.clusters.map((c: Cluster) => c.id)));
      if (forets?.season) {
        const bad = Object.entries(forets.j1 as Record<string, number>)
          .filter(([, v]) => v >= 4).map(([d]) => d);
        const dk = `toast_danger4_${today}`;
        if (bad.length && !localStorage.getItem(dk)) {
          pushToast({ id: dk, title: "VERY HIGH FIRE DANGER TOMORROW", msg: `Departments: ${bad.join(", ")}` });
          localStorage.setItem(dk, "1");
        }
      }
      cl.clusters
        .filter((c: Cluster) => c.active && c.vig?.cocktail && (c.score ?? 0) >= 50)
        .slice(0, 3).forEach((c: Cluster) => {
          const k = `toast_cocktail_${c.id}_${today}`;
          if (!localStorage.getItem(k)) {
            pushToast({ id: k, title: "⚠ COCKTAIL WIND + CANICULE",
              msg: `${c.name} (${c.dept}) — combined orange warnings`, clusterId: c.id });
            localStorage.setItem(k, "1");
          }
        });
    } catch { /* localStorage indisponible */ }

    setClusters(cl.clusters);
    setFires(fi.features);
    const times = fi.features.map((f: any) => f.properties.t);
    if (times.length) setTl((cur) => ({ ...cur, min: Math.min(...times), max: Math.max(...times) }));
    if (selectedRef.current) {
      const again = cl.clusters.find((c: Cluster) => c.id === selectedRef.current!.id);
      if (again) setSelected(again);
    }
    setRefreshAt(Date.now() + REFRESH_MS);
  }, [pushToast]);

  useEffect(() => {
    loadAll(range).catch(() => pushToast({ id: "load-error", title: "DATA UNAVAILABLE", msg: "Fire data could not be loaded. The latest available data remains displayed." }));
  }, [range, loadAll]);

  // rafraîchissement automatique horaire
  useEffect(() => {
    const iv = setInterval(() => {
      if (Date.now() >= refreshAt && !document.hidden) { setRefreshAt(Date.now() + 60000); loadAll(range).catch(() => {}); }
    }, 5000);
    return () => clearInterval(iv);
  }, [refreshAt, range, loadAll]);

  // navigation clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onSelect = useCallback((c: Cluster) => {
    setSelectedWeather(null);
    setSelected(c);
  }, []);

  const onWeather = useCallback((fireId: string, weather: any) => {
    if (selectedRef.current?.id === fireId) setSelectedWeather(weather);
  }, []);

  return (
    <div id="app">
      <Header clusters={clusters} firesCount={fires.length} range={range}
        refreshAt={refreshAt} onRange={setRange} onStats={() => setStatsOpen(true)} />
      <div id="main">
        <Sidebar clusters={clusters} selectedId={selected?.id ?? null}
          onSelect={onSelect} search={search} onSearch={setSearch} />
        <div id="mapwrap">
          <MapView clusters={clusters} fires={fires} layers={layers} choro={choro}
            tlCursor={tl.cursor} selected={selected} selectedWeather={selectedWeather}
            mfForets={mfForets} mfVig={mfVig} onSelect={onSelect}
            onDeptClick={setSearch} onAirLegend={setAirLegend} />
          <LayersPanel layers={layers} choro={choro} onLayers={setLayers} onChoro={setChoro} />
          <AirLegend visible={airLegend && layers.air} />
          <Timeline tl={tl} onChange={setTl} />
          <Toasts toasts={toasts}
            onClick={(t) => {
              const c = clusters.find((x) => x.id === t.clusterId);
              if (c) onSelect(c);
            }}
            onClose={(id) => setToasts((cur) => cur.filter((x) => x.id !== id))} />
          <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
          <Dossier fire={selected} range={range} mfForets={mfForets}
            openrouter={flags.openrouter} exa={flags.exa}
            onClose={() => setSelected(null)} onWeather={onWeather} />
        </div>
      </div>
    </div>
  );
}
