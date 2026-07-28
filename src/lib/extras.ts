import { db } from "./db";
import { miscGet, miscSet } from "./cache";
import { distKm } from "./geo";
import { getClusters } from "./clusters";
import { getMfForets } from "./meteoFrance";

// ------------------------------------------------- infrastructures (Overpass)

const OVERPASS_QUERY = `[out:json][timeout:20];
(
  nwr[amenity~"^(school|hospital|clinic|kindergarten|fire_station)$"](around:{r},{lat},{lon});
  nwr[tourism="camp_site"](around:{r},{lat},{lon});
  nwr[social_facility~"^(nursing_home|assisted_living)$"](around:{r},{lat},{lon});
);
out center 60;`;

const INFRA_LABELS: Record<string, string> = {
  school: "École", kindergarten: "Crèche/maternelle", hospital: "Hôpital",
  clinic: "Clinique", fire_station: "Caserne pompiers", camp_site: "Camping",
  nursing_home: "EHPAD", assisted_living: "Résidence seniors",
};

export async function getInfra(lat: number, lon: number, radiusM = 3000) {
  const key = `infra:${lat.toFixed(2)},${lon.toFixed(2)},${radiusM}`;
  const cached = miscGet(key, 86400);
  if (cached) return cached;
  const q = OVERPASS_QUERY.replaceAll("{r}", String(radiusM))
    .replaceAll("{lat}", String(lat)).replaceAll("{lon}", String(lon));
  let data: any;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: q }),
      signal: AbortSignal.timeout(25000),
    });
    data = await r.json();
  } catch (e: any) {
    return { error: e.message, items: [] };
  }
  const items = (data.elements || []).map((el: any) => {
    const tags = el.tags || {};
    const kind = tags.amenity || tags.tourism || tags.social_facility || "?";
    const elat = el.lat ?? el.center?.lat;
    const elon = el.lon ?? el.center?.lon;
    if (elat == null) return null;
    return { kind: INFRA_LABELS[kind] || kind, name: tags.name || "(sans nom)",
      dist_km: +distKm(lat, lon, elat, elon).toFixed(1) };
  }).filter(Boolean).sort((a: any, b: any) => a.dist_km - b.dist_km);
  const out = { items: items.slice(0, 40), radius_m: radiusM };
  miscSet(key, out);
  return out;
}

// --------------------------------------------------------------- statistiques

export async function getStats() {
  const now = Math.floor(Date.now() / 1000);
  const daily = db().prepare(
    "SELECT date(epoch,'unixepoch') d, COUNT(*) n, ROUND(SUM(frp),1) frp FROM hotspots WHERE epoch > ? GROUP BY d ORDER BY d")
    .all(now - 30 * 86400);
  const clusters = await getClusters("7d");
  const depts = new Map<string, any>();
  for (const c of clusters) {
    if (!c.dept) continue;
    const d = depts.get(c.dept) ?? depts.set(c.dept, {
      dept: c.dept, dept_name: c.dept_name, frp: 0, fires: 0, detections: 0, area_km2: 0,
    }).get(c.dept);
    d.frp += c.frp; d.fires += 1; d.detections += c.n; d.area_km2 += c.area_km2;
  }
  const deptList = [...depts.values()].sort((a, b) => b.frp - a.frp)
    .map((d) => ({ ...d, frp: +d.frp.toFixed(1), area_km2: +d.area_km2.toFixed(1) }));
  const season = db().prepare(
    "SELECT COUNT(DISTINCT fid) fires, ROUND(SUM(a),1) area FROM (SELECT fid, MAX(area_km2) a FROM clusters_history GROUP BY fid)")
    .get() as any;
  const histDays = db().prepare(
    "SELECT COUNT(DISTINCT date(ts,'unixepoch')) d FROM clusters_history").get() as any;
  let forets: any = null;
  try {
    forets = await getMfForets();
  } catch { /* facultatif */ }
  return {
    daily, depts: deptList,
    season: { fires: season.fires, area_km2: season.area, history_days: histDays.d },
    forets,
  };
}
