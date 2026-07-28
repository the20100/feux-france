import { db } from "./db";
import { miscGet, miscSet } from "./cache";
import { convexHull, hullAreaKm2, DEPTS } from "./geo";
import { getRows, RANGES, type Hotspot } from "./firms";
import { geocodeClusters, popWithin } from "./geocode";
import { getMeteo } from "./openMeteo";
import { getMfForets, getMfVigilance, getMfObs } from "./meteoFrance";

const CELL = 0.02;          // ~2 km : cellules voisines = même foyer
const CLUSTERS_TTL = 300;
const SNAP_INTERVAL = 1500; // snapshot de l'état des foyers ~25 min
const GEOCODE_TOP = 80;
const SCORE_TOP = 60;       // foyers avec météo/score complets
const OBS_TOP = 25;         // foyers enrichis du vent mesuré en station

const clustersCache = new Map<string, { at: number; data: any[] }>();
let building: Promise<any[]> | null = null;

function buildRaw(rows: Hotspot[], rangeKey: string): any[] {
  // grille + union-find 8-connexité
  const grid = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = `${Math.floor(r.lon / CELL)},${Math.floor(r.lat / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  const parent = new Map<string, string>();
  const find = (c: string): string => {
    let r = c;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = c;
    while (parent.get(cur) !== r) { const n = parent.get(cur)!; parent.set(cur, r); cur = n; }
    return r;
  };
  for (const k of grid.keys()) parent.set(k, k);
  for (const k of grid.keys()) {
    const [cx, cy] = k.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nb = `${cx + dx},${cy + dy}`;
        if (grid.has(nb)) {
          const ra = find(k), rb = find(nb);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
  }
  const groups = new Map<string, number[]>();
  for (const [k, idxs] of grid) {
    const root = find(k);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(...idxs);
  }

  const now = Date.now() / 1000;
  const spanH = RANGES[rangeKey];
  const nBuckets = Math.floor(spanH / 6);
  const clusters: any[] = [];
  for (const idxs of groups.values()) {
    const pts = idxs.map((i) => rows[i]);
    const frpTotal = pts.reduce((s, p) => s + p.frp, 0) || 0.001;
    const wLat = frpTotal > 0.01
      ? pts.reduce((s, p) => s + p.lat * p.frp, 0) / frpTotal
      : pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const wLon = frpTotal > 0.01
      ? pts.reduce((s, p) => s + p.lon * p.frp, 0) / frpTotal
      : pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    const first = Math.min(...pts.map((p) => p.epoch));
    const last = Math.max(...pts.map((p) => p.epoch));
    const hull = convexHull(pts.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)]));
    const last12 = pts.filter((p) => p.epoch > now - 12 * 3600).reduce((s, p) => s + p.frp, 0);
    const prev12 = pts.filter((p) => p.epoch > now - 24 * 3600 && p.epoch <= now - 12 * 3600)
      .reduce((s, p) => s + p.frp, 0);
    const buckets = new Array(nBuckets).fill(0);
    for (const p of pts) {
      const k = Math.floor((now - p.epoch) / (6 * 3600));
      if (k >= 0 && k < nBuckets) buckets[nBuckets - 1 - k] += p.frp;
    }
    clusters.push({
      id: `${wLat.toFixed(2)}_${wLon.toFixed(2)}`,
      lat: +wLat.toFixed(5), lon: +wLon.toFixed(5),
      n: pts.length, frp: +frpTotal.toFixed(1),
      frp_max: +Math.max(...pts.map((p) => p.frp)).toFixed(1),
      first, last,
      active: now - last < 18 * 3600,
      trend: last12 > prev12 * 1.15 + 0.5 ? "up" : last12 < prev12 * 0.85 ? "down" : "flat",
      hull, area_km2: +hullAreaKm2(hull, wLat).toFixed(1),
      sats: [...new Set(pts.map((p) => p.sat))].sort(),
      buckets: buckets.map((b) => +b.toFixed(1)),
    });
  }
  clusters.sort((a, b) => b.frp - a.frp);
  return clusters;
}

/** Reprise = détections passées au même endroit, puis silence ≥ 48 h. */
function detectReprises(clusters: any[]): void {
  const since = Math.floor(Date.now() / 1000) - 60 * 86400;
  const pts = db().prepare("SELECT lat, lon, epoch FROM hotspots WHERE epoch > ?").all(since) as any[];
  for (const c of clusters) {
    const lons = c.hull.length ? c.hull.map((p: number[]) => p[0]) : [c.lon];
    const lats = c.hull.length ? c.hull.map((p: number[]) => p[1]) : [c.lat];
    const [loX, hiX] = [Math.min(...lons) - 0.01, Math.max(...lons) + 0.01];
    const [loY, hiY] = [Math.min(...lats) - 0.01, Math.max(...lats) + 0.01];
    const cutoff = c.first - 6 * 3600;
    let prevLast: number | null = null;
    for (const p of pts) {
      if (p.epoch < cutoff && p.lat >= loY && p.lat <= hiY && p.lon >= loX && p.lon <= hiX)
        if (prevLast === null || p.epoch > prevLast) prevLast = p.epoch;
    }
    c.reprise = prevLast !== null && c.first - prevLast > 48 * 3600;
  }
}

/** Score de menace 0-100 : intensité + activité + vent (mesuré si possible)
 *  + sécheresse + population + reprise + danger officiel + cocktail vigilance. */
async function computeScores(clusters: any[]): Promise<void> {
  const [forets, vig] = await Promise.all([
    getMfForets().catch(() => ({ season: false } as any)),
    getMfVigilance().catch(() => ({ depts: {} } as any)),
  ]);
  const dangerJ1 = forets.j1 || {};
  const dangerJ2 = forets.j2 || {};
  const vigDepts = vig.depts || {};
  const obsSet = new Set(clusters.filter((c) => c.active).slice(0, OBS_TOP).map((c) => c.id));

  const base = (c: any) => {
    let s = Math.min(35, 9 * Math.log10(1 + c.frp));
    if (c.active) s += 10;
    if (c.trend === "up") s += 8;
    if (c.reprise) s += 5;
    return s;
  };
  const applyOfficial = (c: any) => {
    c.danger_j1 = dangerJ1[c.dept] ?? null;
    c.danger_j2 = dangerJ2[c.dept] ?? null;
    const dv = vigDepts[c.dept] || {};
    c.vig = { max: dv.max || 1, phen: dv.phen || [], cocktail: !!dv.cocktail, orage: !!dv.orage };
    let bonus = 0;
    if (c.danger_j1 === 3) bonus += 6;
    else if (c.danger_j1 === 4) bonus += 10;
    if (c.vig.cocktail && c.active) bonus += 8;
    return bonus;
  };

  const top = clusters.slice(0, SCORE_TOP);
  await Promise.all(top.map(async (c) => {
    c.pop_5km = popWithin(c.lat, c.lon, 5);
    let s = base(c) + applyOfficial(c) + Math.min(12, 3.2 * Math.log10(1 + c.pop_5km));
    let gusts: number | null = null, rh: number | null = null;
    if (obsSet.has(c.id)) {
      const obs = await getMfObs(c.lat, c.lon).catch(() => ({ error: "x" } as any));
      if (!obs.error) {
        c.obs = obs;
        gusts = obs.current.gust_kmh;
        rh = obs.current.rh;
        c.wind = obs.current.wind_kmh;
        c.wind_dir = obs.current.wind_dir;
        c.wind_src = "station";
      }
    }
    if (gusts == null && c.active) {
      const m = await getMeteo(c.lat, c.lon).catch(() => null);
      const cur = m?.weather?.current;
      if (cur) {
        gusts = cur.wind_gusts_10m || 0;
        rh = cur.relative_humidity_2m ?? null;
        c.wind = Math.round(cur.wind_speed_10m || 0);
        c.wind_dir = cur.wind_direction_10m;
        c.wind_src = "modèle";
      }
    }
    if (gusts != null) {
      c.gusts = Math.round(gusts);
      s += Math.min(20, gusts * 0.25);
    }
    if (rh != null && rh < 60) s += Math.min(15, (60 - rh) * 0.45);
    c.score = Math.min(100, Math.round(s));
  }));
  for (const c of clusters.slice(SCORE_TOP)) {
    c.pop_5km = null;
    const s = base(c) + applyOfficial(c);
    c.vig.phen = [];
    c.score = Math.min(100, Math.round(s));
  }
}

/** Archive l'état courant des foyers (plage 24h uniquement, ~25 min). */
function maybeSnapshot(clusters: any[]): void {
  if (miscGet("last_snapshot", SNAP_INTERVAL)) return;
  const now = Math.floor(Date.now() / 1000);
  const ins = db().prepare(
    "INSERT OR REPLACE INTO clusters_history (ts, fid, lat, lon, frp, n, area_km2, active, score, commune, dept) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  db().transaction(() => clusters.forEach((c) =>
    ins.run(now, c.id, c.lat, c.lon, c.frp, c.n, c.area_km2, c.active ? 1 : 0,
      c.score ?? null, c.commune ?? null, c.dept ?? null)))();
  miscSet("last_snapshot", { ts: now, n: clusters.length });
}

export async function getClusters(rangeKey: string): Promise<any[]> {
  const cached = clustersCache.get(rangeKey);
  if (cached && Date.now() / 1000 - cached.at < CLUSTERS_TTL) return cached.data;
  if (building) await building.catch(() => {});
  const again = clustersCache.get(rangeKey);
  if (again && Date.now() / 1000 - again.at < CLUSTERS_TTL) return again.data;

  building = (async () => {
    const rows = await getRows(rangeKey);
    const clusters = buildRaw(rows, rangeKey);
    await geocodeClusters(clusters.slice(0, GEOCODE_TOP));
    for (const c of clusters) {
      c.commune ??= null;
      c.dept ??= null;
      c.dept_name = DEPTS[c.dept || ""] ?? null;
      c.name = c.commune ? `Feu de ${c.commune}` : `Foyer ${c.lat.toFixed(2)}N ${c.lon.toFixed(2)}E`;
    }
    detectReprises(clusters);
    await computeScores(clusters);
    if (rangeKey === "24h") maybeSnapshot(clusters);
    clustersCache.set(rangeKey, { at: Date.now() / 1000, data: clusters });
    return clusters;
  })();
  try {
    return await building;
  } finally {
    building = null;
  }
}

/** Cycle de vie : série temporelle des snapshots des foyers proches. */
export function getHistory(lat: number, lon: number, radiusKm = 8) {
  const rows = db().prepare(
    "SELECT ts, frp, n, area_km2 FROM clusters_history WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY ts")
    .all(lat - radiusKm / 110.57, lat + radiusKm / 110.57,
      lon - radiusKm / 85, lon + radiusKm / 85) as any[];
  const series = new Map<number, any>();
  for (const r of rows) {
    const s = series.get(r.ts) ?? { ts: r.ts, frp: 0, n: 0, area: 0 };
    s.frp += r.frp; s.n += r.n; s.area = Math.max(s.area, r.area_km2);
    series.set(r.ts, s);
  }
  return { points: [...series.values()].sort((a, b) => a.ts - b.ts) };
}
