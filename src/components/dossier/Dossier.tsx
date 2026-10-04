"use client";

import { useEffect, useRef } from "react";
import { fmtInt, fmtDT, fmtAgo, scoreClass, frpLabel, type Cluster } from "../format";
import RisqueBlock from "./RisqueBlock";
import MeteoBlock from "./MeteoBlock";
import ClimatBlock from "./ClimatBlock";
import EnjeuxBlock from "./EnjeuxBlock";
import SatelliteView from "./SatelliteView";
import AiSummary from "./AiSummary";
import Feed from "./Feed";

type Props = {
  fire: Cluster | null;
  range: string;
  mfForets: any;
  openrouter: boolean;
  exa: boolean;
  onClose: () => void;
  onWeather: (fireId: string, weather: any) => void;
};

export default function Dossier({ fire, range, mfForets, openrouter, exa, onClose, onWeather }: Props) {
  const c = fire;
  return (
    <div id="dossier" className={c ? "open" : ""}>
      {c && (
        <>
          <div className="dhead">
            <div className="row1">
              <h2>{c.name}</h2>
              <button id="dclose" onClick={onClose}>✕</button>
            </div>
            <div className="dsub">
              {c.dept_name ? `${c.dept_name} (${c.dept}) · ` : ""}
              {c.lat.toFixed(4)}N {c.lon.toFixed(4)}E
              {c.population ? ` · municipality: ${fmtInt(c.population)} residents` : ""}
            </div>
            <div className="status-badges">
              <span className={`score-pill ${scoreClass(c.score)}`}
                style={{ fontSize: 12, padding: "2px 8px" }} title="Threat score">
                THREAT {c.score ?? "–"}/100
              </span>
              <span className={`sbadge ${c.active ? "actif" : "cool"}`}>
                {c.active ? "● ACTIVE" : "COOLING"}
              </span>
              <span className={`sbadge ${c.trend}`}>
                {c.trend === "up" ? "▲ INTENSIFYING" : c.trend === "down" ? "▼ DECREASING" : "― STABLE"}
              </span>
              {c.reprise && (
                <span className="badge-reprise" style={{ fontSize: 10, padding: "2px 6px" }}>
                  ⟳ REIGNITION AFTER 48 H+
                </span>
              )}
            </div>
          </div>
          <div id="dbody">
            <div className="sect">Situation</div>
            <Situation c={c} range={range} />
            <div className="sect">Official risk — Météo-France</div>
            <RisqueBlock c={c} season={mfForets?.season} />
            <div className="sect">Local weather</div>
            <MeteoBlock c={c} onWeather={onWeather} />
            <div className="sect">Climate context</div>
            <ClimatBlock c={c} />
            <div className="sect">Exposure — population &amp; infrastructure</div>
            <EnjeuxBlock c={c} />
            <div className="sect">Satellite imagery</div>
            <SatelliteView c={c} />
            <div className="sect">Open-source intelligence</div>
            {openrouter && <AiSummary c={c} range={range} />}
            <Feed c={c} exa={exa} />
            <div className="sect">Imagery &amp; links</div>
            <ExtLinks c={c} />
          </div>
        </>
      )}
    </div>
  );
}

function Situation({ c, range }: { c: Cluster; range: string }) {
  const sparkRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = sparkRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const W = (cv.width = cv.clientWidth * 2);
    const H = (cv.height = 104);
    ctx.clearRect(0, 0, W, H);
    const buckets = c.buckets;
    const max = Math.max(...buckets, 1);
    const bw = W / buckets.length;
    buckets.forEach((b, i) => {
      const h = Math.max(3, (b / max) * (H - 10));
      const g = ctx.createLinearGradient(0, H - h, 0, H);
      g.addColorStop(0, i === buckets.length - 1 ? "#ffb03a" : "#ff6a2b");
      g.addColorStop(1, "#7c2d12");
      ctx.fillStyle = b === 0 ? "#1b2733" : g;
      ctx.fillRect(i * bw + 1.5, H - h, bw - 3, h);
    });
  }, [c.id, c.buckets]);
  return (
    <>
      <div className="statgrid">
        <Stat v={c.frp >= 1000 ? `${(c.frp / 1000).toFixed(2)} ` : `${c.frp} `}
          unit={c.frp >= 1000 ? "GW" : "MW"} l="Total FRP" />
        <Stat v={`${c.frp_max} `} unit="MW" l="FRP max / pixel" />
        <Stat v={String(c.n)} l="Detections" />
        <Stat v={c.area_km2 ? `${c.area_km2} ` : "< 0.1 "} unit="km²" l="Estimated footprint" />
        <Stat v={fmtDT(c.first)} l="First detection" />
        <Stat v={fmtDT(c.last)} unit={`(${fmtAgo(c.last)})`} l="Latest overpass" />
      </div>
      <canvas id="spark" ref={sparkRef} />
      <div className="sparkcap">
        <span>-{range === "7d" ? "7 d" : range === "48h" ? "48 h" : "24 h"}</span>
        <span>FRP / 6 h</span><span>now</span>
      </div>
    </>
  );
}

function Stat({ v, unit, l }: { v: string; unit?: string; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}{unit && <em>{unit}</em>}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function ExtLinks({ c }: { c: Cluster }) {
  const d = new Date(c.last * 1000).toISOString().slice(0, 10);
  return (
    <div className="extlinks">
      <a target="_blank" rel="noopener"
        href={`https://worldview.earthdata.nasa.gov/?v=${c.lon - 0.6},${c.lat - 0.4},${c.lon + 0.6},${c.lat + 0.4}&t=${d}&l=Reference_Labels_15m,VIIRS_SNPP_Thermal_Anomalies_375m_All,VIIRS_SNPP_CorrectedReflectance_TrueColor`}>
        NASA Worldview ↗</a>
      <a target="_blank" rel="noopener"
        href={`https://browser.dataspace.copernicus.eu/?zoom=12&lat=${c.lat}&lng=${c.lon}&datasetId=S2_L2A_CDAS`}>
        Sentinel-2 ↗</a>
      <a target="_blank" rel="noopener" href={`https://www.google.com/maps/@${c.lat},${c.lon},12z`}>
        Google Maps ↗</a>
      <a target="_blank" rel="noopener" href="https://vigilance.meteofrance.fr/fr">Météo-France warnings ↗</a>
    </div>
  );
}
