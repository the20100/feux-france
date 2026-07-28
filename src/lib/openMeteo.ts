import { db } from "./db";
import { miscGet, miscSet, fetchRetry } from "./cache";

const METEO_TTL = 900;

/** Météo AROME (Météo-France via Open-Meteo) + qualité de l'air au point. */
export async function getMeteo(lat: number, lon: number) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const now = Math.floor(Date.now() / 1000);
  const row = db().prepare("SELECT ts, payload FROM meteo_cache WHERE key = ?").get(key) as any;
  if (row && now - row.ts < METEO_TTL) return JSON.parse(row.payload);

  const cur = "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m," +
    "wind_gusts_10m,precipitation,soil_moisture_3_to_9cm";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=${cur}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,` +
    `relative_humidity_2m,temperature_2m,precipitation&forecast_hours=48` +
    `&daily=precipitation_sum&past_days=14&forecast_days=2&timezone=UTC` +
    `&models=meteofrance_seamless`;
  const out: any = { weather: null, air: null };
  try {
    out.weather = await (await fetchRetry(url, { signal: AbortSignal.timeout(15000) })).json();
    const w = out.weather;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const pairs = w.daily.time.map((d: string, i: number) => [d, w.daily.precipitation_sum[i]])
        .filter(([d]: any) => d <= today).sort().reverse();
      let dsr = 0;
      for (const [, mm] of pairs) {
        if (mm != null && mm > 1) break;
        dsr++;
      }
      let gmax = -1, gtime = null;
      w.hourly.wind_gusts_10m.forEach((g: number, i: number) => {
        if (g != null && g > gmax) { gmax = g; gtime = w.hourly.time[i]; }
      });
      out.derived = { days_since_rain: dsr, max_gust_48h: Math.round(gmax), max_gust_time: gtime };
    } catch {
      out.derived = null;
    }
  } catch (e: any) {
    out.weather_error = e.message;
  }
  try {
    out.air = await (await fetchRetry(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10`,
      { signal: AbortSignal.timeout(15000) })).json();
  } catch (e: any) {
    out.air_error = e.message;
  }
  if (out.weather)
    db().prepare("INSERT OR REPLACE INTO meteo_cache (key, ts, payload) VALUES (?,?,?)")
      .run(key, now, JSON.stringify(out));
  return out;
}

// ------------------------------------------------------------ grilles de vent
// Fine 0,5° pour le présent (léger : pas d'historique), 1° pour l'historique.
const GRID_FINE = {
  lons: Array.from({ length: 31 }, (_, i) => +(-5.5 + i * 0.5).toFixed(2)),
  lats: Array.from({ length: 21 }, (_, j) => +(51.5 - j * 0.5).toFixed(2)),
  dx: 0.5, key: "windseries_fine", params: "&past_days=0&forecast_days=2",
};
const GRID_HIST = {
  lons: Array.from({ length: 16 }, (_, i) => +(-5.5 + i).toFixed(1)),
  lats: Array.from({ length: 11 }, (_, j) => +(51.5 - j).toFixed(1)),
  dx: 1.0, key: "windseries_hist", params: "&past_days=7&forecast_days=1",
};

async function fetchWindSeries(grid: typeof GRID_FINE) {
  const cached = miscGet(grid.key, 3600);
  if (cached) return cached;
  const coords: [number, number][] = [];
  for (const lat of grid.lats) for (const lon of grid.lons) coords.push([lat, lon]);
  const out: any = { times: null, points: {} };
  try {
    // chunks séquentiels espacés : on lisse le quota-minute d'Open-Meteo
    for (let i = 0; i < coords.length; i += 88) {
      if (i) await new Promise((r) => setTimeout(r, 3000));
      const chunk = coords.slice(i, i + 88);
      const url = `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}` +
        `&hourly=wind_speed_10m,wind_direction_10m${grid.params}&timezone=UTC&models=meteofrance_seamless`;
      let data = await (await fetchRetry(url, { signal: AbortSignal.timeout(40000) })).json();
      if (!Array.isArray(data)) data = [data];
      chunk.forEach((p, k) => {
        const h = data[k]?.hourly || {};
        out.points[`${p[0]},${p[1]}`] = [h.wind_speed_10m || [], h.wind_direction_10m || []];
        if (!out.times && h.time) out.times = h.time;
      });
    }
  } catch (e) {
    const stale = miscGet(grid.key, 7 * 86400); // mieux vaut vieux que rien
    if (stale) return stale;
    throw e;
  }
  miscSet(grid.key, out);
  return out;
}

/** Grille u/v pour leaflet-velocity à l'heure demandée (epoch, défaut now). */
export async function getWindGrid(t?: number) {
  const now = Date.now() / 1000;
  const grid = t == null || t >= now - 2 * 3600 ? GRID_FINE : GRID_HIST;
  let s: any;
  try {
    s = await fetchWindSeries(grid);
  } catch (e: any) {
    return { error: e.message };
  }
  const times: string[] = s.times || [];
  if (!times.length) return { error: "vent indisponible" };
  const target = new Date((t ?? now) * 1000).toISOString().slice(0, 13) + ":00";
  let idx = 0, best = Infinity;
  times.forEach((iso, i) => {
    const d = Math.abs(Date.parse(iso + ":00Z") - Date.parse(target + ":00Z"));
    if (d < best) { best = d; idx = i; }
  });
  const u: number[] = [], v: number[] = [];
  for (const lat of grid.lats) {
    for (const lon of grid.lons) {
      const [spdArr, dirArr] = s.points[`${lat},${lon}`] || [[], []];
      const spd = (spdArr[idx] ?? 0) / 3.6;
      const dir = ((dirArr[idx] ?? 0) * Math.PI) / 180;
      u.push(+(-spd * Math.sin(dir)).toFixed(2));
      v.push(+(-spd * Math.cos(dir)).toFixed(2));
    }
  }
  const header = {
    parameterCategory: 2, nx: grid.lons.length, ny: grid.lats.length,
    lo1: grid.lons[0], la1: grid.lats[0], lo2: grid.lons.at(-1), la2: grid.lats.at(-1),
    dx: grid.dx, dy: grid.dx, refTime: times[idx],
  };
  return [
    { header: { ...header, parameterNumber: 2 }, data: u },
    { header: { ...header, parameterNumber: 3 }, data: v },
  ];
}

/** Grille AQI européen pour l'overlay qualité de l'air. */
export async function getAirGrid() {
  const cached = miscGet("airgrid", 1800);
  if (cached) return cached;
  const g = GRID_FINE;
  const coords: [number, number][] = [];
  for (const lat of g.lats) for (const lon of g.lons) coords.push([lat, lon]);
  const vals = new Map<string, [number | null, number | null]>();
  try {
    for (let i = 0; i < coords.length; i += 88) {
      if (i) await new Promise((r) => setTimeout(r, 2000));
      const chunk = coords.slice(i, i + 88);
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}` +
        `&current=european_aqi,pm2_5`;
      let data = await (await fetchRetry(url, { signal: AbortSignal.timeout(40000) })).json();
      if (!Array.isArray(data)) data = [data];
      chunk.forEach((p, k) => {
        const c = data[k]?.current || {};
        vals.set(`${p[0]},${p[1]}`, [c.european_aqi ?? null, c.pm2_5 ?? null]);
      });
    }
  } catch (e: any) {
    const stale = miscGet("airgrid", 86400);
    return stale ?? { error: e.message };
  }
  const aqi = g.lats.map((lat) => g.lons.map((lon) => vals.get(`${lat},${lon}`)?.[0] ?? null));
  const pm25 = g.lats.map((lat) => g.lons.map((lon) => vals.get(`${lat},${lon}`)?.[1] ?? null));
  const out = { nx: g.lons.length, ny: g.lats.length, lo1: g.lons[0], la1: g.lats[0],
    dx: g.dx, aqi, pm25, generated: new Date().toISOString() };
  miscSet("airgrid", out);
  return out;
}

/** Contexte sécheresse : cumuls vs normales 1991-2020 (archive ERA5). */
export async function getClimate(lat: number, lon: number) {
  const key = `climate:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = miscGet(key, 86400);
  if (cached) return cached;
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  try {
    const normals = await (await fetchRetry(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=1991-01-01&end_date=2020-12-31&daily=precipitation_sum&timezone=UTC`,
      { signal: AbortSignal.timeout(45000) })).json();
    const cur = await (await fetchRetry(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${year}-03-01&end_date=${now.toISOString().slice(0, 10)}` +
      `&daily=precipitation_sum&timezone=UTC`,
      { signal: AbortSignal.timeout(30000) })).json();
    const monthByYear: Record<number, number> = {}, springByYear: Record<number, number> = {};
    normals.daily.time.forEach((d: string, i: number) => {
      const mm = normals.daily.precipitation_sum[i];
      if (mm == null) return;
      const y = +d.slice(0, 4), m = +d.slice(5, 7);
      if (m === month) monthByYear[y] = (monthByYear[y] || 0) + mm;
      if (m >= 3 && m <= 6) springByYear[y] = (springByYear[y] || 0) + mm;
    });
    const avg = (o: Record<number, number>) =>
      Object.values(o).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(o).length);
    let monthCur = 0, springCur = 0;
    cur.daily.time.forEach((d: string, i: number) => {
      const mm = cur.daily.precipitation_sum[i];
      if (mm == null) return;
      const m = +d.slice(5, 7);
      if (m === month) monthCur += mm;
      if (m >= 3 && m <= 6) springCur += mm;
    });
    const out = {
      month: { current: +monthCur.toFixed(1), normal: +avg(monthByYear).toFixed(1) },
      spring: { current: +springCur.toFixed(1), normal: +avg(springByYear).toFixed(1) },
    };
    miscSet(key, out);
    return out;
  } catch (e: any) {
    return { error: e.message };
  }
}

/** Prévision d'ensemble : incertitude sur les rafales des prochaines 24 h. */
export async function getEnsemble(lat: number, lon: number) {
  const key = `ensemble:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = miscGet(key, 3 * 3600);
  if (cached) return cached;
  // l'ensemble Météo-France n'est pas distribué par Open-Meteo → ICON-EPS puis GFS
  for (const model of ["icon_seamless", "gfs_seamless"]) {
    try {
      const data = await (await fetchRetry(
        `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}` +
        `&hourly=wind_gusts_10m&models=${model}&forecast_days=2&timezone=UTC`,
        { signal: AbortSignal.timeout(25000) })).json();
      const members = Object.keys(data.hourly || {}).filter((k) => k.startsWith("wind_gusts_10m"));
      if (members.length < 10) continue;
      const maxes = members
        .map((m) => Math.max(...data.hourly[m].slice(0, 24).filter((v: any) => v != null)))
        .filter((v) => isFinite(v))
        .sort((a, b) => a - b);
      if (!maxes.length) continue;
      const out = {
        members: maxes.length,
        median_max_gust: Math.round(maxes[Math.floor(maxes.length / 2)]),
        p90_max_gust: Math.round(maxes[Math.max(0, Math.floor(maxes.length * 0.9) - 1)]),
        pct_over_50: Math.round((100 * maxes.filter((v) => v >= 50).length) / maxes.length),
        model,
      };
      miscSet(key, out);
      return out;
    } catch {
      continue;
    }
  }
  return { error: "ensemble indisponible" };
}

export const windGrids = { GRID_FINE, GRID_HIST, fetchWindSeries };
