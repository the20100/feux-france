"use client";

import { useEffect, useState } from "react";
import { degToCard, type Cluster } from "../format";

export default function MeteoBlock({ c, onWeather }:
  { c: Cluster; onWeather: (fireId: string, weather: any) => void }) {
  const [m, setM] = useState<any>(null);
  const [ens, setEns] = useState<any>(null);

  useEffect(() => {
    setM(null); setEns(null);
    let alive = true;
    fetch(`/api/meteo?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setM(d);
      if (d.weather) onWeather(c.id, d.weather);
    }).catch(() => alive && setM({ weather_error: "x" }));
    fetch(`/api/ensemble?lat=${c.lat}&lon=${c.lon}`).then((r) => r.json())
      .then((d) => alive && setEns(d)).catch(() => {});
    return () => { alive = false; };
  }, [c.id]);

  if (!m) return <div id="meteo"><div className="loading-bar" /></div>;
  const w = m.weather?.current;
  if (!w) return <div id="meteo"><div className="intel-msg">Weather unavailable.</div></div>;

  const der = m.derived;
  const soil = w.soil_moisture_3_to_9cm;
  const pm = m.air?.current?.pm2_5;
  const pmClass = pm == null ? "" : pm < 15 ? "pm-good" : pm < 50 ? "pm-mid" : pm < 100 ? "pm-high" : "pm-danger";
  const pmLabel = pm == null ? "–" : pm < 15 ? "good" : pm < 50 ? "moderate" : pm < 100 ? "high" : "danger";
  const gustMax = Math.max(...(m.weather.hourly?.wind_gusts_10m || [0]).filter((x: any) => x != null));
  const danger = w.wind_speed_10m > 30 && w.relative_humidity_2m < 30;
  const obs = c.obs;
  const fmtT = (iso: string) => {
    try {
      return new Date(iso + ":00Z").toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <div id="meteo">
      <div className="mrow">
        <div className="windbox">
          <svg width="34" height="34" viewBox="0 0 34 34"
            style={{ transform: `rotate(${(w.wind_direction_10m + 180) % 360}deg)`, transition: "transform .5s" }}>
            <path d="M17 3 L23 21 L17 17 L11 21 Z" fill="#38c8dc" />
          </svg>
          <div>
            <div className="wv">{Math.round(w.wind_speed_10m)} <span style={{ fontSize: 10 }}>km/h</span></div>
            <div className="wl">WIND {degToCard(w.wind_direction_10m)} · GUSTS {Math.round(w.wind_gusts_10m)} km/h</div>
          </div>
        </div>
      </div>
      {danger && (
        <div style={{ marginTop: 7, fontSize: 11, color: "var(--red)", fontWeight: 700 }}>
          ⚠ AGGRAVATING CONDITIONS: strong wind + dry air
        </div>
      )}
      <div className="mgrid">
        <div className="stat"><div className="v">{Math.round(w.temperature_2m)}°</div><div className="l">Temp.</div></div>
        <div className="stat">
          <div className="v" style={{ color: w.relative_humidity_2m < 30 ? "var(--red)" : "var(--fg)" }}>
            {w.relative_humidity_2m}%</div>
          <div className="l">Humidity</div>
        </div>
        <div className="stat"><div className="v">{Math.round(gustMax)}</div><div className="l">Max gust 48 h</div></div>
        <div className="stat"><div className={`v ${pmClass}`}>{pm ?? "–"}</div><div className="l">PM2.5 {pmLabel}</div></div>
      </div>
      {der && der.max_gust_48h >= 40 && (
        <div className="gust-alert">⚠ Peak gust <b>{der.max_gust_48h} km/h</b> expected {fmtT(der.max_gust_time)}</div>
      )}
      {der && (
        <div className="soil-line">
          Dry conditions: <b className={der.days_since_rain >= 7 ? "dry" : ""}>{der.days_since_rain} days without rain</b>
          {soil != null ? ` · soil moisture ${Math.round(soil * 250)}%` : ""}
        </div>
      )}
      {obs?.station && <ObsBox obs={obs} />}
      {ens && !ens.error && (
        <div style={{ marginTop: 7, fontSize: 11,
          color: ens.pct_over_50 >= 30 ? "var(--yellow)" : "var(--muted)" }}>
          Uncertainty ({ens.members} scenarios {ens.model.split("_")[0]}) : max gusts over 24 h —
          median {ens.median_max_gust} km/h, 90th percentile {ens.p90_max_gust} km/h ·{" "}
          <b>{ens.pct_over_50}%</b> of scenarios exceed 50 km/h
        </div>
      )}
    </div>
  );
}

function ObsBox({ obs }: { obs: any }) {
  const cur = obs.current;
  const ago = cur.time ? Math.round((Date.now() - Date.parse(cur.time)) / 60000) : null;
  return (
    <div className="obs-box">
      <div className="ot">
        MEASURED WIND — station {obs.station.name} ({obs.station.dist_km} km)
        {ago != null ? ` · ${ago} min ago` : ""}
      </div>
      <div className="om">
        <svg width="14" height="14" viewBox="0 0 34 34"
          style={{ verticalAlign: -2, transform: `rotate(${((cur.wind_dir ?? 0) + 180) % 360}deg)` }}>
          <path d="M17 3 L23 21 L17 17 L11 21 Z" fill="#38c8dc" />
        </svg>{" "}
        {cur.wind_kmh} km/h {degToCard(cur.wind_dir ?? 0)} · gusts <b>{cur.gust_kmh} km/h</b> ·{" "}
        {cur.rh ?? "–"}% RH · {cur.temp ?? "–"}°
      </div>
      {obs.bascule && (
        <div className="bascule-warn">
          ⚠ WIND SHIFT : {obs.bascule.delta_deg}° over 3 h
          ({degToCard(obs.bascule.from_dir)} → {degToCard(obs.bascule.to_dir)})
        </div>
      )}
    </div>
  );
}
