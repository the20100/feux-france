import { db } from "./db";

// Indicatifs Sécurité Civile (tronqués à 8 car. en ADS-B), Canadairs italiens
// (CAN## en mission rescEU) et croates (HR888…) + immatriculations F-ZB*/I-DPC*
const AC_CALLSIGN = /^(PELICA|MILAN|DRAG|BENGA|CAN\d{2}|HR8\d{2})/i;
const AC_REG = /^(F-?ZB|I-?DPC)/i;
const AC_TYPES: Record<string, string> = {
  CL2T: "Canadair CL-415", AT8T: "AT-802 Fire Boss", DH8D: "Dash 8 Q400MR",
  EC45: "Hélico Dragon (EC145)", EC30: "Hélico Dragon (EC130)",
  BE20: "Beech 200 (coordination)",
};
const OPERATORS: [RegExp, string][] = [
  [/^F-?ZB/i, "Sécurité Civile 🇫🇷"],
  [/^I-?DPC/i, "Vigili del Fuoco 🇮🇹"],
  [/^HR/i, "Force aérienne 🇭🇷"],
];

const OPENSKY_ID = (process.env.OPENSKY_CLIENT_ID || "").trim();
const OPENSKY_SECRET = (process.env.OPENSKY_CLIENT_SECRET || "").trim();
let openskyTok: { t: string | null; exp: number } = { t: null, exp: 0 };
const lastTrackFill = new Map<string, number>();

function operatorOf(reg: string, callsign: string): string {
  for (const [pat, name] of OPERATORS)
    if (pat.test(reg || "") || (name.endsWith("🇭🇷") && (callsign || "").toUpperCase().startsWith("HR8")))
      return name;
  return "?";
}

/** Positions actuelles de la flotte via adsb.lol (2 zones = métropole). */
async function fetchBombardiers() {
  const seen = new Map<string, any>();
  for (const [lat, lon] of [[48.5, 2.5], [44.0, 3.0]]) {
    try {
      const r = await fetch(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`,
        { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      for (const a of d.ac || []) {
        const cs = (a.flight || "").trim();
        const reg = (a.r || "").trim();
        if (!(AC_CALLSIGN.test(cs) || AC_REG.test(reg))) continue;
        if (a.lat == null || seen.has(a.hex)) continue;
        seen.set(a.hex, {
          icao: a.hex, callsign: cs || reg, reg, actype: a.t || "",
          lat: a.lat, lon: a.lon,
          alt_ft: typeof a.alt_baro === "number" ? a.alt_baro : 0,
          gs_kt: a.gs || 0, track: a.track ?? null,
        });
      }
    } catch { /* zone injoignable */ }
  }
  return seen;
}

async function openskyToken(): Promise<string> {
  if (openskyTok.t && Date.now() / 1000 < openskyTok.exp - 60) return openskyTok.t;
  const r = await fetch(
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials",
        client_id: OPENSKY_ID, client_secret: OPENSKY_SECRET }),
      signal: AbortSignal.timeout(20000),
    });
  const tok = await r.json();
  openskyTok = { t: tok.access_token, exp: Date.now() / 1000 + (tok.expires_in || 1800) };
  return openskyTok.t!;
}

/** Complète les traces avec les waypoints complets OpenSky (1 appel par
 *  appareil en vol toutes les 10 min max). */
async function backfillTracks(seen: Map<string, any>) {
  if (!OPENSKY_ID) return;
  const now = Date.now() / 1000;
  const ins = db().prepare(
    "INSERT OR IGNORE INTO aircraft_tracks (icao, ts, callsign, reg, actype, lat, lon, alt_ft, gs_kt, track) VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const [hex, p] of seen) {
    if (now - (lastTrackFill.get(hex) || 0) < 600) continue;
    try {
      const r = await fetch(`https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`, {
        headers: { Authorization: `Bearer ${await openskyToken()}` },
        signal: AbortSignal.timeout(25000),
      });
      const d = await r.json();
      const rows = (d.path || []).filter((wp: any[]) => wp[1] != null);
      db().transaction(() => {
        for (const wp of rows)
          ins.run(hex, Math.floor(wp[0]), p.callsign, p.reg, p.actype,
            wp[1], wp[2], Math.round((wp[3] || 0) / 0.3048), null, wp[4]);
      })();
      lastTrackFill.set(hex, now);
    } catch { /* non bloquant */ }
  }
}

/** Un tick de l'enregistreur : scan + insertion + backfill.
 *  Retourne true si des appareils sont en vol (→ resserrer la cadence). */
export async function aircraftTick(): Promise<boolean> {
  const seen = await fetchBombardiers();
  if (seen.size) {
    const now = Math.floor(Date.now() / 1000);
    const ins = db().prepare(
      "INSERT OR IGNORE INTO aircraft_tracks (icao, ts, callsign, reg, actype, lat, lon, alt_ft, gs_kt, track) VALUES (?,?,?,?,?,?,?,?,?,?)");
    db().transaction(() => {
      for (const p of seen.values())
        ins.run(p.icao, now, p.callsign, p.reg, p.actype, p.lat, p.lon,
          p.alt_ft, p.gs_kt, p.track);
    })();
    await backfillTracks(seen);
  }
  return seen.size > 0;
}

/** Flotte + traînes de 2 h, en direct (t absent) ou à un instant passé. */
export function getAircraft(t?: number) {
  const end = t ? Math.floor(t) : Math.floor(Date.now() / 1000);
  const rows = db().prepare(
    "SELECT * FROM aircraft_tracks WHERE ts BETWEEN ? AND ? ORDER BY ts")
    .all(end - 2 * 3600, end) as any[];
  const fleet = new Map<string, any>();
  for (const r of rows) {
    const f = fleet.get(r.icao) ?? fleet.set(r.icao, {
      icao: r.icao, callsign: r.callsign, reg: r.reg, actype: r.actype,
      type_name: AC_TYPES[r.actype] || r.actype,
      operator: operatorOf(r.reg, r.callsign), trail: [],
    }).get(r.icao);
    if (r.callsign) f.callsign = r.callsign;
    f.trail.push([r.lat, r.lon, r.ts, r.alt_ft, r.gs_kt, r.track]);
  }
  const out = [...fleet.values()].map((f) => {
    const last = f.trail[f.trail.length - 1];
    f.last = { lat: last[0], lon: last[1], ts: last[2], alt_ft: last[3],
      gs_kt: last[4], track: last[5] };
    // gs NULL sur les waypoints OpenSky → inconnu = en vol si récent
    f.airborne = end - last[2] < 1500 && (last[4] == null || last[4] > 40);
    return f;
  }).sort((a, b) => b.last.ts - a.last.ts);
  const first = db().prepare("SELECT MIN(ts) m FROM aircraft_tracks").get() as any;
  return { aircraft: out, t: end, recording_since: first?.m ?? null };
}
