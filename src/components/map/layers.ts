/**
 * Modules de rendu des couches Leaflet. Chaque fonction synchronise une
 * couche à partir de l'état courant — la carte reste impérative (Leaflet),
 * React pilote via MapView.
 */
import L from "leaflet";
import "leaflet.heat";
import "leaflet-velocity";
import { VIG_COLORS, DANGER_LABELS, scoreClass, type Cluster } from "../format";

export type MapCtx = {
  map: L.Map;
  canvasRenderer: L.Canvas;
  hotspotLayer: L.LayerGroup;
  hullLayer: L.LayerGroup;
  markerLayer: L.LayerGroup;
  coneLayer: L.LayerGroup;
  stationsLayer: L.LayerGroup;
  aircraftLayer: L.LayerGroup;
  deptLayer: L.GeoJSON | null;
  heatLayer: any;
  windLayer: any;
  rainLayer: L.TileLayer | null;
  airLayer: L.LayerGroup | null;
  deptGeo: any;
};

const ageColor = (h: number) =>
  h < 6 ? "#ff2d00" : h < 24 ? "#ff9500" : h < 48 ? "#ffd60a" : "#6d6d72";

export function renderHotspots(ctx: MapCtx, fires: any[], cursor: number | null, show: boolean) {
  ctx.hotspotLayer.clearLayers();
  if (!show) return;
  const nowS = Date.now() / 1000;
  const zoom = ctx.map.getZoom();
  // décimation au zoom national : 11 000 points indiscernables → 1 sur 3
  const stride = fires.length > 6000 && zoom <= 7 ? 3 : fires.length > 3000 && zoom <= 6 ? 2 : 1;
  for (let i = 0; i < fires.length; i += stride) {
    const f = fires[i];
    const t = f.properties.t;
    if (cursor !== null && t > cursor) continue;
    const refAge = cursor !== null ? (cursor - t) / 3600 : (nowS - t) / 3600;
    const [lon, lat] = f.geometry.coordinates;
    L.circleMarker([lat, lon], {
      renderer: ctx.canvasRenderer, radius: refAge < 6 ? 3.2 : 2.2,
      color: ageColor(refAge), fillColor: ageColor(refAge),
      weight: 0, fillOpacity: refAge < 6 ? 0.95 : refAge < 24 ? 0.6 : 0.3,
      interactive: false,
    }).addTo(ctx.hotspotLayer);
  }
}

export function renderHeat(ctx: MapCtx, fires: any[], cursor: number | null, show: boolean) {
  if (ctx.heatLayer) { ctx.map.removeLayer(ctx.heatLayer); ctx.heatLayer = null; }
  if (!show) return;
  const pts = fires
    .filter((f) => cursor === null || f.properties.t <= cursor)
    .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0],
      Math.min(1, Math.log10(1 + f.properties.frp) / 2)]);
  ctx.heatLayer = (L as any).heatLayer(pts, {
    radius: 18, blur: 22, maxZoom: 11,
    gradient: { 0.3: "#3b0a02", 0.5: "#b83206", 0.7: "#ff6a2b", 0.9: "#ffd60a", 1: "#fff" },
  }).addTo(ctx.map);
}

export function renderMarkersAndHulls(
  ctx: MapCtx, clusters: Cluster[], opts: {
    showHulls: boolean; showLabels: boolean; selectedId: string | null;
    onSelect: (c: Cluster) => void;
  },
) {
  ctx.hullLayer.clearLayers();
  ctx.markerLayer.clearLayers();
  if (opts.showHulls) {
    for (const c of clusters) {
      if (c.hull.length < 3) continue;
      L.polygon(c.hull.map((p) => [p[1], p[0]] as [number, number]), {
        color: c.active ? "#ff6a2b" : "#666", weight: 1.3, dashArray: "4 3",
        fillColor: c.active ? "#ff6a2b" : "#666", fillOpacity: 0.12,
      }).addTo(ctx.hullLayer).on("click", () => opts.onSelect(c));
    }
  }
  // perf : des animations infinies éparpillées fusionnent leurs zones de
  // repaint en plein écran → seul le foyer SÉLECTIONNÉ pulse
  const glowing = new Set(
    [...clusters].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .filter((c) => c.active).slice(0, 30).map((c) => c.id));
  for (const c of clusters.slice(0, 300)) {
    const size = Math.max(14, Math.min(52, 10 + Math.sqrt(c.frp) * 1.6));
    const anim = opts.selectedId === c.id && c.active;
    const icon = L.divIcon({
      className: "", iconSize: [size, size],
      html: `<div class="fmark ${c.active ? "" : "cool"}${glowing.has(c.id) ? " glow" : ""}" style="width:${size}px;height:${size}px">
               <div class="ring${anim ? " anim" : ""}"></div><div class="core"></div>
               ${opts.showLabels && c.commune ? `<div class="lbl">${c.commune}</div>` : ""}
             </div>`,
    });
    L.marker([c.lat, c.lon], { icon, zIndexOffset: Math.round(c.frp) })
      .addTo(ctx.markerLayer).on("click", () => opts.onSelect(c));
  }
}

export async function renderChoro(
  ctx: MapCtx, mode: string, clusters: Cluster[],
  mfForets: any, mfVig: any, onDeptClick: (nom: string) => void,
) {
  if (ctx.deptLayer) { ctx.map.removeLayer(ctx.deptLayer); ctx.deptLayer = null; }
  if (mode === "none") return;
  if (!ctx.deptGeo) ctx.deptGeo = await (await fetch("/departements.geojson")).json();
  const frpByDept: Record<string, number> = {};
  clusters.forEach((c) => { if (c.dept) frpByDept[c.dept] = (frpByDept[c.dept] || 0) + c.frp; });
  const maxFrp = Math.max(...Object.values(frpByDept), 1);
  const dangers = mode === "danger1" ? mfForets?.j1 : mode === "danger2" ? mfForets?.j2 : null;
  const vigD = mfVig?.depts || {};

  const styleFor = (code: string) => {
    if (mode === "activity") {
      const v = frpByDept[code] || 0;
      const t = v ? Math.log10(1 + v) / Math.log10(1 + maxFrp) : 0;
      return {
        fill: t ? `rgb(${Math.round(120 + 135 * t)},${Math.round(60 * (1 - t) + 45)},20)` : "#111",
        op: t ? 0.25 + 0.45 * t : 0.04,
      };
    }
    const lvl = mode === "vigilance" ? vigD[code]?.max || 1 : dangers?.[code] || 0;
    if (!lvl) return { fill: "#111", op: 0.04 };
    return { fill: VIG_COLORS[lvl], op: lvl === 1 ? 0.1 : 0.18 + lvl * 0.09 };
  };
  const tipFor = (code: string, nom: string) => {
    if (mode === "activity")
      return `${nom} (${code}) — ${Math.round(frpByDept[code] || 0).toLocaleString("fr-FR")} MW`;
    if (mode === "vigilance") {
      const d = vigD[code];
      const names = ["", "verte", "jaune", "orange", "rouge"];
      const phen = (d?.phen || [])
        .map((p: any) => `${p.name} ${names[p.level]}`).join(" · ");
      return `${nom} (${code}) — vigilance ${names[d?.max || 1]}${phen ? "<br>" + phen : ""}`;
    }
    const lvl = dangers?.[code];
    return `${nom} (${code}) — danger ${lvl ? DANGER_LABELS[lvl] : "n.d."}`;
  };

  ctx.deptLayer = L.geoJSON(ctx.deptGeo, {
    style: (f: any) => {
      const s = styleFor(f.properties.code);
      return { color: "#2c3a48", weight: 0.8, fillColor: s.fill, fillOpacity: s.op };
    },
    onEachFeature: (f: any, l: any) => {
      l.bindTooltip(tipFor(f.properties.code, f.properties.nom), { sticky: true });
      l.on("click", () => onDeptClick(f.properties.nom));
    },
  }).addTo(ctx.map);
  ctx.deptLayer.bringToBack();
}

export function renderStations(ctx: MapCtx, clusters: Cluster[], show: boolean) {
  ctx.stationsLayer.clearLayers();
  if (!show) { ctx.map.removeLayer(ctx.stationsLayer); return; }
  const seen = new Set<string>();
  for (const c of clusters) {
    const st = c.obs?.station;
    if (!st || seen.has(st.id)) continue;
    seen.add(st.id);
    const cur = c.obs.current;
    const rot = ((cur.wind_dir ?? 0) + 180) % 360;
    const icon = L.divIcon({
      className: "", iconSize: [46, 30],
      html: `<div style="text-align:center">
        <svg width="20" height="20" viewBox="0 0 34 34" style="transform:rotate(${rot}deg)">
          <path d="M17 3 L23 21 L17 17 L11 21 Z" fill="#38c8dc"/></svg>
        <div style="font:9px ui-monospace,monospace;color:#7fd4e6;text-shadow:0 1px 2px #000">${cur.gust_kmh} km/h</div>
      </div>`,
    });
    L.marker([st.lat, st.lon], { icon })
      .bindTooltip(`${st.name} — vent mesuré ${cur.wind_kmh} km/h, rafales ${cur.gust_kmh} km/h`)
      .addTo(ctx.stationsLayer);
  }
  ctx.stationsLayer.addTo(ctx.map);
}

/** Trajectoire de propagation 6 h (vents AROME chaînés, départ vent mesuré). */
export function drawCone(ctx: MapCtx, c: Cluster | null, weather: any) {
  ctx.coneLayer.clearLayers();
  if (!c || !weather) return;
  const w = weather.current || {};
  const hourly = weather.hourly || {};
  const gusts0 = c.obs?.current?.gust_kmh ?? w.wind_gusts_10m;
  if (!c.active || !gusts0 || gusts0 < 10) return;
  const kx = 111.32 * Math.cos((c.lat * Math.PI) / 180);
  const ky = 110.57;
  const path: [number, number][] = [[c.lat, c.lon]];
  let lat = c.lat, lon = c.lon;
  let lastDir = ((w.wind_direction_10m ?? 0) + 180) % 360;
  for (let h = 0; h < 6; h++) {
    let spd = hourly.wind_speed_10m?.[h];
    let dir = hourly.wind_direction_10m?.[h];
    if (h === 0 && c.obs?.current?.wind_dir != null) dir = c.obs.current.wind_dir;
    if (spd == null || dir == null) break;
    lastDir = (dir + 180) % 360;
    const th = (lastDir * Math.PI) / 180;
    const stepKm = Math.min(6, Math.max(0.5, spd * 0.1));
    lat += (stepKm * Math.cos(th)) / ky;
    lon += (stepKm * Math.sin(th)) / kx;
    path.push([lat, lon]);
  }
  if (path.length < 2) return;
  L.polyline(path, { color: "#ff2d00", weight: 2, opacity: 0.75, dashArray: "1 6",
    interactive: false }).addTo(ctx.coneLayer);
  path.slice(1).forEach((p, i) =>
    L.circleMarker(p, { radius: 2.5, color: "#ff2d00", fillColor: "#ff2d00",
      fillOpacity: 0.9, weight: 0, interactive: false })
      .addTo(ctx.coneLayer).bindTooltip(`+${i + 1} h`));
  const th0 = (lastDir * Math.PI) / 180;
  const spread = Math.min(14, Math.max(3, gusts0 * 0.18));
  const end = path[path.length - 1];
  const pts: [number, number][] = [end];
  for (let a = -22; a <= 22; a += 5.5) {
    const th = th0 + (a * Math.PI) / 180;
    pts.push([end[0] + (spread * Math.cos(th)) / ky, end[1] + (spread * Math.sin(th)) / kx]);
  }
  L.polygon(pts, { color: "#ff2d00", weight: 1, dashArray: "3 4", opacity: 0.5,
    fillColor: "#ff2d00", fillOpacity: 0.09, interactive: false }).addTo(ctx.coneLayer);
}

// ------------------------------------------------------------------ vent animé

const windCache = new Map<number, Promise<any>>();

export async function syncWind(ctx: MapCtx, on: boolean, cursor: number | null) {
  if (ctx.windLayer) { ctx.map.removeLayer(ctx.windLayer); ctx.windLayer = null; }
  if (!on) return;
  const hour = Math.floor((cursor ?? Date.now() / 1000) / 3600);
  if (!windCache.has(hour))
    windCache.set(hour, fetch(`/api/wind?t=${hour * 3600}`).then((r) => r.json()));
  const data = await windCache.get(hour)!;
  if (data.error || !on) return;
  ctx.windLayer = (L as any).velocityLayer({
    data, displayValues: true,
    displayOptions: { velocityType: "vent", position: "bottomleft",
      emptyString: "—", speedUnit: "k/h", showCardinal: true },
    maxVelocity: 18, velocityScale: 0.01,
    particleAge: 55, particleMultiplier: 1 / 700, lineWidth: 1.1, frameRate: 12,
    colorScale: ["#5b6a76", "#8fa3b0", "#b9cdd8", "#7fd4e6", "#38c8dc", "#7ae0b8"],
  }).addTo(ctx.map);
}

export async function syncRain(ctx: MapCtx, on: boolean) {
  if (ctx.rainLayer) { ctx.map.removeLayer(ctx.rainLayer); ctx.rainLayer = null; }
  if (!on) return;
  try {
    const wm = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const frame = wm.radar.past[wm.radar.past.length - 1];
    // maxNativeZoom 10 : au-delà les tuiles n'existent pas → upscale
    ctx.rainLayer = L.tileLayer(`${wm.host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0.55, maxNativeZoom: 10, maxZoom: 19, attribution: "RainViewer",
    }).addTo(ctx.map);
  } catch { /* source indisponible */ }
}

// ------------------------------------------------------------- qualité de l'air

// Étapes [AQI, r, g, b, alpha] interpolées : ≤ 35 invisible → îlots seulement
const AQI_STOPS: [number, number, number, number, number][] = [
  [35, 255, 240, 150, 0], [50, 255, 230, 120, 0.22], [65, 255, 190, 60, 0.4],
  [80, 255, 122, 40, 0.55], [100, 255, 45, 30, 0.68], [130, 150, 60, 220, 0.78],
];
const AQI_LEVELS: [number, string, string][] = [
  [20, "bon", "#50c878"], [40, "moyen", "#a3d977"], [60, "dégradé", "#f9d71c"],
  [80, "mauvais", "#ff5a2c"], [100, "très mauvais", "#ff2d1e"],
  [9999, "extrêmement mauvais", "#9640dc"],
];

function aqiColor(aqi: number): number[] {
  if (aqi <= AQI_STOPS[0][0]) return [0, 0, 0, 0];
  const last = AQI_STOPS[AQI_STOPS.length - 1];
  if (aqi >= last[0]) return last.slice(1) as number[];
  for (let i = 1; i < AQI_STOPS.length; i++) {
    const [a1, ...c1] = AQI_STOPS[i - 1];
    const [a2, ...c2] = AQI_STOPS[i];
    if (aqi <= a2) {
      const t = (aqi - a1) / (a2 - a1);
      return c1.map((v, k) => v + (c2[k] - v) * t);
    }
  }
  return [0, 0, 0, 0];
}

export async function syncAir(ctx: MapCtx, on: boolean): Promise<boolean> {
  if (ctx.airLayer) { ctx.map.removeLayer(ctx.airLayer); ctx.airLayer = null; }
  if (!on) return false;
  const g = await (await fetch("/api/air")).json();
  if (g.error || !on) return false;
  const cv = document.createElement("canvas");
  cv.width = g.nx; cv.height = g.ny;
  const cx = cv.getContext("2d")!;
  const img = cx.createImageData(g.nx, g.ny);
  for (let y = 0; y < g.ny; y++)
    for (let x = 0; x < g.nx; x++) {
      const aqi = g.aqi[y][x];
      if (aqi == null) continue;
      const [r, gr, b, a] = aqiColor(aqi);
      const i = (y * g.nx + x) * 4;
      img.data[i] = Math.round(r); img.data[i + 1] = Math.round(gr);
      img.data[i + 2] = Math.round(b); img.data[i + 3] = Math.round(a * 255);
    }
  cx.putImageData(img, 0, 0);
  const h = g.dx / 2;
  const group = L.layerGroup([
    L.imageOverlay(cv.toDataURL(), [[41.5 - h, -5.5 - h], [51.5 + h, 9.5 + h]],
      { opacity: 0.9, interactive: false }),
  ]);
  // étiquettes sur les maxima locaux (~250 km d'écart)
  const maxima: { v: number; lat: number; lon: number }[] = [];
  for (let y = 0; y < g.ny; y++)
    for (let x = 0; x < g.nx; x++) {
      const v = g.aqi[y][x];
      if (v == null || v < 45) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = g.aqi[y + dy]?.[x + dx];
          if (n != null && n > v) { isMax = false; break; }
        }
      if (isMax) maxima.push({ v, lat: g.la1 - y * g.dx, lon: g.lo1 + x * g.dx });
    }
  maxima.sort((a, b) => b.v - a.v);
  const kept: typeof maxima = [];
  for (const m of maxima) {
    if (kept.length >= 5) break;
    if (kept.every((k) => Math.hypot(k.lat - m.lat, k.lon - m.lon) > 2.3)) kept.push(m);
  }
  for (const m of kept) {
    const [, label, color] = AQI_LEVELS.find((l) => m.v <= l[0])!;
    group.addLayer(L.marker([m.lat, m.lon], {
      interactive: false, zIndexOffset: 2000,
      icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [-14, 18],
        html: `<div class="air-label" style="border-left-color:${color}">
            <div class="alt">Qualité de l'air estimée</div>
            <div class="alv"><b>${Math.round(m.v)}</b>${label}</div></div>` }),
    }));
  }
  ctx.airLayer = group.addTo(ctx.map);
  return true;
}

// ------------------------------------------------------------------- aéronefs

const AC_COLORS: Record<string, string> = {
  CL2T: "#ff5a2c", AT8T: "#ffb03a", DH8D: "#ff9500",
  EC45: "#38c8dc", EC30: "#38c8dc", BE20: "#d7dde3",
};

export async function syncAircraft(ctx: MapCtx, on: boolean, cursor: number | null) {
  ctx.aircraftLayer.clearLayers();
  if (!on) { ctx.map.removeLayer(ctx.aircraftLayer); return; }
  ctx.aircraftLayer.addTo(ctx.map);
  const url = "/api/aircraft" + (cursor !== null ? `?t=${Math.round(cursor)}` : "");
  const d = await fetch(url).then((r) => r.json()).catch(() => null);
  if (!d || !on) return;
  const esc = (s: string) => (s || "").replace(/</g, "&lt;");
  for (const f of d.aircraft) {
    const color = AC_COLORS[f.actype] || "#b8c2cb";
    const pts = f.trail.map((p: any[]) => [p[0], p[1]] as [number, number]);
    if (pts.length > 1)
      L.polyline(pts, { color, weight: 2, opacity: 0.55, dashArray: "1 6",
        interactive: false }).addTo(ctx.aircraftLayer);
    const last = f.last;
    const rot = Math.round(last.track ?? 0);
    const icon = L.divIcon({
      className: "", iconSize: [46, 34], iconAnchor: [23, 12],
      html: `<div class="${f.airborne ? "" : "ac-ground"}" style="text-align:center">
        <svg width="22" height="22" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)">
          <path d="M12 1.5 L14 9 L22 13 L22 15 L14 13.5 L13.5 19 L16 21 L16 22.5 L12 21.5 L8 22.5 L8 21 L10.5 19 L10 13.5 L2 15 L2 13 L10 9 Z" fill="${color}"/>
        </svg>
        <div class="ac-label">${esc(f.callsign)}</div></div>`,
    });
    const ageMin = Math.round((d.t - last.ts) / 60);
    L.marker([last.lat, last.lon], { icon, zIndexOffset: 3000 })
      .bindPopup(`<b>${esc(f.callsign)}</b> · ${esc(f.reg)}<br>${esc(f.type_name)}` +
        `${f.operator && f.operator !== "?" ? " · " + esc(f.operator) : ""}<br>` +
        `${f.airborne ? "En vol" : "Au sol / signal perdu"} · alt ${Math.round((last.alt_ft || 0) * 0.3048)} m · ` +
        `${Math.round((last.gs_kt || 0) * 1.852)} km/h<br>Position il y a ${ageMin} min`)
      .addTo(ctx.aircraftLayer);
  }
}
