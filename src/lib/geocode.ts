import { db } from "./db";
import { distKm } from "./geo";

/** Télécharge une fois les ~35 000 communes (nom, dept, population, centre). */
export async function ensureCommunes(): Promise<void> {
  if (db().prepare("SELECT 1 FROM communes LIMIT 1").get()) return;
  const r = await fetch(
    "https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,population,centre",
    { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`communes: http ${r.status}`);
  const data = await r.json();
  const ins = db().prepare("INSERT OR IGNORE INTO communes VALUES (?,?,?,?,?,?)");
  db().transaction(() => {
    for (const c of data) {
      if (!c.centre) continue;
      ins.run(c.code, c.nom, c.codeDepartement, c.population || 0,
        c.centre.coordinates[1], c.centre.coordinates[0]);
    }
  })();
  console.log(`communes: ${data.length} chargées en base`);
}

export function communesWithin(lat: number, lon: number, radiusKm: number) {
  const dl = radiusKm / 110.57;
  const dlon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const rows = db().prepare(
    "SELECT nom, dept, population, lat, lon FROM communes WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?")
    .all(lat - dl, lat + dl, lon - dlon, lon + dlon) as any[];
  return rows
    .map((r) => ({ nom: r.nom, dept: r.dept, population: r.population,
      dist_km: +distKm(lat, lon, r.lat, r.lon).toFixed(1) }))
    .filter((r) => r.dist_km <= radiusKm)
    .sort((a, b) => a.dist_km - b.dist_km);
}

export function popWithin(lat: number, lon: number, radiusKm: number): number {
  return communesWithin(lat, lon, radiusKm).reduce((s, c) => s + c.population, 0);
}

/** Commune la plus proche de chaque foyer (geo.api.gouv, cache permanent). */
export async function geocodeClusters(clusters: any[]): Promise<void> {
  const get = db().prepare("SELECT commune, dept, population FROM geocode WHERE key = ?");
  const put = db().prepare(
    "INSERT OR REPLACE INTO geocode (key, commune, dept, population, ts) VALUES (?,?,?,?,?)");
  const todo: any[] = [];
  for (const c of clusters) {
    const key = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
    const row = get.get(key) as any;
    if (row) Object.assign(c, row);
    else todo.push([key, c]);
  }
  await Promise.all(todo.map(async ([key, c]) => {
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?lat=${c.lat}&lon=${c.lon}&fields=nom,codeDepartement,population`,
        { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      const info = data?.[0]
        ? { commune: data[0].nom, dept: data[0].codeDepartement, population: data[0].population ?? null }
        : { commune: null, dept: null, population: null };
      Object.assign(c, info);
      put.run(key, info.commune, info.dept, info.population, Math.floor(Date.now() / 1000));
    } catch {
      /* on retentera au prochain calcul */
    }
  }));
}
