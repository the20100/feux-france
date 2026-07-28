"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Cluster } from "../format";

// NASA GIBS — VIIRS quotidien 375 m + HLS 30 m (revisite 2-5 j)
const GIBS_LAYERS: Record<string, { id: string; max: number; ext: string; zoom: number }> = {
  viirs: { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", max: 9, ext: "jpg", zoom: 8 },
  l30: { id: "HLS_L30_Nadir_BRDF_Adjusted_Reflectance", max: 12, ext: "png", zoom: 11 },
  s30: { id: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance", max: 12, ext: "png", zoom: 11 },
};

export default function SatelliteView({ c }: { c: Cluster }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const [layer, setLayer] = useState("viirs");
  const [date, setDate] = useState(() => new Date(Date.now() - 86400e3));

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const conf = GIBS_LAYERS[layer];
    map.setView([c.lat, c.lon], conf.zoom);
    if (tilesRef.current) map.removeLayer(tilesRef.current);
    const dateStr = date.toISOString().slice(0, 10);
    tilesRef.current = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${conf.id}/default/${dateStr}/GoogleMapsCompatible_Level${conf.max}/{z}/{y}/{x}.${conf.ext}`,
      { maxNativeZoom: conf.max, maxZoom: 12 }).addTo(map);
    L.circleMarker([c.lat, c.lon], { radius: 7, color: "#ff2d00", weight: 2, fill: false }).addTo(map);
    setTimeout(() => map.invalidateSize(), 300);
  }, [c.id, layer, date]);

  const step = (days: number) =>
    setDate((d) => new Date(Math.min(+d + days * 86400e3, Date.now() - 86400e3)));

  return (
    <div id="satwrap">
      <div id="satmap" ref={divRef} />
      <div className="satctl">
        <select value={layer} onChange={(e) => setLayer(e.target.value)}>
          <option value="viirs">VIIRS 375 m (quotidien)</option>
          <option value="l30">Landsat HLS 30 m</option>
          <option value="s30">Sentinel-2 HLS 30 m</option>
        </select>
        <button onClick={() => step(-1)}>◀</button>
        <span className="sdate">{date.toISOString().slice(0, 10)}</span>
        <button onClick={() => step(1)}>▶</button>
      </div>
      <div className="satnote">
        NASA GIBS — image noire/vide = pas d'acquisition ce jour-là (revisite 2-5 j pour le 30 m).
      </div>
    </div>
  );
}
