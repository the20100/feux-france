import { db } from "./db";
import { inFrance } from "./geo";

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire";
const SOURCES: Record<string, string> = {
  "S-NPP": "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_{r}.csv",
  "NOAA-20": "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_{r}.csv",
  "NOAA-21": "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_{r}.csv",
};
export const RANGES: Record<string, number> = { "24h": 24, "48h": 48, "7d": 168 };
const FIRMS_TTL = 600;

let ingesting: Promise<number> | null = null;

export type Hotspot = {
  lat: number; lon: number; epoch: number; sat: string;
  frp: number; conf: string; daynight: string;
};

/** Télécharge les CSV FIRMS de la plage si le cache a expiré, insère en base
 *  (INSERT OR IGNORE : les détections déjà connues ne coûtent rien). */
export async function ingestFirms(rangeKey: string, force = false): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const log = db().prepare("SELECT fetched_at FROM fetch_log WHERE range_key = ?")
    .get(rangeKey) as any;
  if (log && !force && now - log.fetched_at < FIRMS_TTL) return 0;
  if (ingesting) return ingesting; // évite le double téléchargement concurrent

  ingesting = (async () => {
    const errors: string[] = [];
    const rows: any[][] = [];
    await Promise.all(Object.entries(SOURCES).map(async ([sat, tpl]) => {
      try {
        const r = await fetch(`${FIRMS_BASE}/${tpl.replace("{r}", rangeKey)}`,
          { signal: AbortSignal.timeout(40000) });
        if (!r.ok) throw new Error(`http ${r.status}`);
        const text = await r.text();
        const lines = text.split("\n");
        const header = lines[0].split(",");
        const idx = (k: string) => header.indexOf(k);
        const [iLat, iLon, iDate, iTime, iFrp, iConf, iDn] =
          ["latitude", "longitude", "acq_date", "acq_time", "frp", "confidence", "daynight"].map(idx);
        for (const line of lines.slice(1)) {
          const c = line.split(",");
          const lat = parseFloat(c[iLat]);
          const lon = parseFloat(c[iLon]);
          if (!isFinite(lat) || !isFinite(lon) || !inFrance(lon, lat)) continue;
          const t = (c[iTime] || "0").padStart(4, "0");
          const epoch = Date.parse(`${c[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`) / 1000;
          if (!isFinite(epoch)) continue;
          rows.push([+lat.toFixed(5), +lon.toFixed(5), epoch, sat,
            parseFloat(c[iFrp]) || 0, c[iConf] || "", c[iDn] || ""]);
        }
      } catch (e: any) {
        errors.push(`${sat}: ${e.message}`);
      }
    }));

    const d = db();
    const before = (d.prepare("SELECT COUNT(*) c FROM hotspots").get() as any).c;
    const ins = d.prepare(
      "INSERT OR IGNORE INTO hotspots (lat, lon, epoch, sat, frp, conf, daynight) VALUES (?,?,?,?,?,?,?)");
    d.transaction(() => rows.forEach((r) => ins.run(...r)))();
    const added = (d.prepare("SELECT COUNT(*) c FROM hotspots").get() as any).c - before;
    d.prepare("INSERT OR REPLACE INTO fetch_log (range_key, fetched_at, rows_added, errors) VALUES (?,?,?,?)")
      .run(rangeKey, now, added, JSON.stringify(errors));
    return added;
  })();
  try {
    return await ingesting;
  } finally {
    ingesting = null;
  }
}

/** Points chauds de la fenêtre demandée, servis depuis la base. */
export async function getRows(rangeKey: string): Promise<Hotspot[]> {
  await ingestFirms(rangeKey);
  const since = Math.floor(Date.now() / 1000) - RANGES[rangeKey] * 3600;
  return db().prepare(
    "SELECT lat, lon, epoch, sat, frp, conf, daynight FROM hotspots WHERE epoch > ?")
    .all(since) as Hotspot[];
}

export function fetchErrors(rangeKey: string): string[] {
  const log = db().prepare("SELECT errors FROM fetch_log WHERE range_key = ?").get(rangeKey) as any;
  try {
    return log ? JSON.parse(log.errors) : [];
  } catch {
    return [];
  }
}
