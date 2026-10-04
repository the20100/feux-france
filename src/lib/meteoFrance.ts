import { db } from "./db";
import { miscGet, miscSet } from "./cache";
import { distKm } from "./geo";

const MF_BASE = "https://public-api.meteofrance.fr/public";
// Un token d'application couvre toutes les souscriptions ; certains peuvent
// être invalides → on essaie chaque variable dans l'ordre et on retient le bon.
const MF_TOKENS = [
  "MF_TOKEN_OBS", "MF_TOKEN_VIGILANCE", "MF_TOKEN_FORETS", "MF_TOKEN_RADAR",
  "MF_TOKEN_CLIMAT", "MF_TOKEN_AROME", "MF_TOKEN_AROME_IF",
].map((k) => (process.env[k] || "").trim()).filter(Boolean);
let goodToken: string | null = null;

export function hasMf(): boolean {
  return MF_TOKENS.length > 0;
}

/** GET Météo-France. Le gateway WSO2 est capricieux sur l'en-tête Accept
 *  (401 selon la ressource) : on tente sans Accept, puis deux variantes. */
async function mfGet(path: string, timeoutMs = 25000): Promise<ArrayBuffer> {
  const tokens = goodToken ? [goodToken, ...MF_TOKENS.filter((t) => t !== goodToken)] : MF_TOKENS;
  let lastErr: any = null;
  for (const token of tokens) {
    for (const accept of [null, "*/*", "application/json"]) {
      const headers: Record<string, string> = { apikey: token };
      if (accept) headers.Accept = accept;
      try {
        const r = await fetch(MF_BASE + path, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status === 404) throw Object.assign(new Error("404"), { notFound: true });
        if (!r.ok) { lastErr = r.status; continue; }
        goodToken = token;
        return await r.arrayBuffer();
      } catch (e: any) {
        if (e.notFound) throw e;
        lastErr = e.message || e;
      }
    }
  }
  throw new Error(`MF: failed (${lastErr})`);
}

// ------------------------------------------------------------ Météo des forêts

/** Niveaux officiels de danger de feu (1-4) par département, J1/J2.
 *  Saisonnier (juin-septembre) : hors saison l'API renvoie 404. */
export async function getMfForets() {
  if (!hasMf()) return { season: false, error: "no_token" };
  const cached = miscGet("mf_forets", 3 * 3600);
  if (cached) return cached;
  let csv: string;
  try {
    csv = new TextDecoder().decode(await mfGet("/DPMeteoForets/v1/carte/encours"));
  } catch (e: any) {
    const out = { season: false, error: e.notFound ? "hors saison" : e.message };
    if (e.notFound) miscSet("mf_forets", out);
    return out;
  }
  const j1: Record<string, number> = {}, j2: Record<string, number> = {};
  let ref: string | null = null;
  const lines = csv.trim().split("\n");
  const header = lines[0].split(";");
  const idx = (k: string) => header.indexOf(k);
  for (const line of lines.slice(1)) {
    const c = line.split(";");
    const dep = c[idx("dep_code")];
    if (!dep) continue;
    ref = c[idx("reference_time")];
    j1[dep] = parseInt(c[idx("niveau_j1")]) || 0;
    j2[dep] = parseInt(c[idx("niveau_j2")]) || 0;
  }
  const out = { season: true, j1, j2, ref };
  miscSet("mf_forets", out);
  // historisation quotidienne (corrélation prévision/réel)
  const day = new Date().toISOString().slice(0, 10);
  const ins = db().prepare("INSERT OR REPLACE INTO mf_forets_history (day, dept, j1, j2) VALUES (?,?,?,?)");
  db().transaction(() => Object.keys(j1).forEach((d) => ins.run(day, d, j1[d], j2[d])))();
  return out;
}

// ----------------------------------------------------------------- Vigilance

export const VIG_PHENOMENES: Record<string, string> = {
  "1": "Strong wind", "2": "Rain and flooding", "3": "Thunderstorms", "4": "River flooding",
  "5": "Snow and ice", "6": "Heatwave", "7": "Extreme cold", "8": "Avalanches",
  "9": "Coastal flooding",
};

/** Vigilance par département : niveau max + phénomènes avec créneau du pic.
 *  color_id : 1 vert, 2 jaune, 3 orange, 4 rouge. */
export async function getMfVigilance() {
  if (!hasMf()) return { depts: {}, error: "no_token" };
  const cached = miscGet("mf_vigilance:en", 900);
  if (cached) return cached;
  let j: any;
  try {
    j = JSON.parse(new TextDecoder().decode(await mfGet("/DPVigilance/v1/cartevigilance/encours")));
  } catch (e: any) {
    return { depts: {}, error: e.message };
  }
  const depts: Record<string, any> = {};
  for (const period of j.product.periods) {
    for (const dom of period.timelaps.domain_ids) {
      const code = dom.domain_id;
      if (!code || code.length > 2) continue;
      const d = (depts[code] ||= { max: 1, phen: [] });
      d.max = Math.max(d.max, dom.max_color_id || 1);
      for (const ph of dom.phenomenon_items || []) {
        const lvl = ph.phenomenon_max_color_id || 1;
        if (lvl < 2) continue;
        const peakItem = (ph.timelaps_items || []).find((tl: any) => tl.color_id === lvl);
        d.phen.push({
          id: ph.phenomenon_id, name: VIG_PHENOMENES[ph.phenomenon_id] || "?",
          level: lvl, echeance: period.echeance,
          peak: peakItem ? { from: peakItem.begin_time, to: peakItem.end_time } : null,
        });
      }
    }
  }
  for (const d of Object.values(depts) as any[]) {
    const levels: Record<string, number> = {};
    d.phen.forEach((p: any) => (levels[p.id] = Math.max(levels[p.id] || 1, p.level)));
    d.cocktail = (levels["1"] || 1) >= 3 && (levels["6"] || 1) >= 3;
    d.orage = (levels["3"] || 1) >= 2;
  }
  const out = { depts, updated: j.product.update_time };
  miscSet("mf_vigilance:en", out);
  return out;
}

/** Textes officiels du bulletin de vigilance pour un département. */
export async function getMfVigilanceTextes(dept: string) {
  let cached = miscGet<any>("mf_vig_textes", 1800);
  if (cached == null) {
    try {
      cached = JSON.parse(new TextDecoder().decode(
        await mfGet("/DPVigilance/v1/textesvigilance/encours"))).product || {};
    } catch {
      cached = {};
    }
    miscSet("mf_vig_textes", cached);
  }
  const out: { title: string; text: string }[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (node.domain_id === dept || node.domain_id === "FRA") {
        const text = node.text ||
          (Array.isArray(node.text_items) ? node.text_items.filter((t: any) => typeof t === "string").join(" ") : "");
        if (text) out.push({ title: node.title || node.bloc_title || "Bulletin", text: text.slice(0, 600) });
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(cached);
  return out.slice(0, 3);
}

// ------------------------------------------------------------ Observations sol

async function getStations(): Promise<any[]> {
  const cached = miscGet<any[]>("mf_stations", 86400);
  if (cached) return cached;
  let text: string;
  try {
    text = new TextDecoder("iso-8859-1").decode(await mfGet("/DPObs/v2/liste-stations"));
  } catch {
    return [];
  }
  const lines = text.trim().split("\n");
  const header = lines[0].split(";");
  const idx = (k: string) => header.indexOf(k);
  const stations = lines.slice(1).map((l) => {
    const c = l.split(";");
    return { id: c[idx("Id_station")], name: c[idx("Nom_usuel")],
      lat: parseFloat(c[idx("Latitude")]), lon: parseFloat(c[idx("Longitude")]),
      pack: c[idx("Pack")] };
  }).filter((s) => isFinite(s.lat));
  miscSet("mf_stations", stations);
  return stations;
}

const fmtObs = (r: any) => ({
  time: r.validity_time,
  temp: r.t != null ? +(r.t - 273.15).toFixed(1) : null,
  rh: r.u ?? null,
  wind_kmh: Math.round((r.ff || 0) * 3.6),
  wind_dir: r.dd ?? null,
  gust_kmh: Math.round((r.raf10 || 0) * 3.6),
  gust_dir: r.ddraf10 ?? null,
  rain_mm: r.rr_per ?? null,
});

/** Dernière observation 6-min de la station la plus proche (< 40 km)
 *  + détection de bascule de vent (mesure d'il y a ~3 h, 1 appel horaire). */
export async function getMfObs(lat: number, lon: number) {
  if (!hasMf()) return { error: "no_token" };
  const key = `mf_obs:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = miscGet(key, 300);
  if (cached) return cached;
  const stations = (await getStations()).filter((s) => s.pack === "RADOME");
  if (!stations.length) return { error: "stations indisponibles" };
  let best = stations[0], bd = Infinity;
  for (const s of stations) {
    const d = distKm(lat, lon, s.lat, s.lon);
    if (d < bd) { bd = d; best = s; }
  }
  if (bd > 40) {
    const out = { error: "No station within 40 km" };
    miscSet(key, out);
    return out;
  }
  let recs: any[];
  try {
    recs = JSON.parse(new TextDecoder().decode(
      await mfGet(`/DPObs/v2/station/infrahoraire-6m?id_station=${best.id}&format=json`)));
  } catch (e: any) {
    return { error: `obs: ${e.message}` };
  }
  if (!recs?.length) return { error: "No data" };
  const cur = recs.reduce((a, b) => ((a.validity_time || "") > (b.validity_time || "") ? a : b));
  let bascule = null;
  try {
    const d3 = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 13) + ":00:00Z";
    const old = JSON.parse(new TextDecoder().decode(await mfGet(
      `/DPObs/v2/station/horaire?id_station=${best.id}&date=${d3}&format=json`)));
    const o = old?.length ? old.reduce((a: any, b: any) =>
      ((a.validity_time || "") > (b.validity_time || "") ? a : b)) : null;
    if (o && cur.dd != null && o.dd != null && (cur.ff || 0) > 2) {
      let delta = Math.abs(cur.dd - o.dd);
      delta = Math.min(delta, 360 - delta);
      if (delta > 45) bascule = { delta_deg: Math.round(delta), from_dir: o.dd, to_dir: cur.dd };
    }
  } catch { /* pas bloquant */ }
  const out = {
    station: { id: best.id, name: best.name, lat: best.lat, lon: best.lon, dist_km: +bd.toFixed(1) },
    current: fmtObs(cur), bascule,
  };
  miscSet(key, out);
  return out;
}
