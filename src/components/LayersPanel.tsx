"use client";

export type LayerState = {
  hulls: boolean; hotspots: boolean; heat: boolean; stations: boolean;
  aircraft: boolean; wind: boolean; rain: boolean; air: boolean;
  labels: boolean; satellite: boolean;
};

export const DEFAULT_LAYERS: LayerState = {
  hulls: true, hotspots: true, heat: false, stations: false, aircraft: false,
  wind: false, rain: false, air: false, labels: false, satellite: false,
};

type Props = {
  layers: LayerState;
  choro: string;
  onLayers: (l: LayerState) => void;
  onChoro: (mode: string) => void;
};

export default function LayersPanel({ layers, choro, onLayers, onChoro }: Props) {
  const box = (key: keyof LayerState, label: React.ReactNode, title?: string) => (
    <label title={title}>
      <input type="checkbox" checked={layers[key]}
        onChange={(e) => onLayers({ ...layers, [key]: e.target.checked })} />{" "}
      {label}
    </label>
  );
  const radio = (value: string, label: React.ReactNode) => (
    <label>
      <input type="radio" name="choro" checked={choro === value}
        onChange={() => onChoro(value)} />{" "}
      {label}
    </label>
  );
  return (
    <div id="layers">
      <div className="t">Layers</div>
      <div className="lgrp">Observed</div>
      {box("hulls", "Fire cluster outlines")}
      {box("hotspots", "Hotspots")}
      {box("heat", "Heatmap")}
      {box("stations", "Measured wind (stations)")}
      {box("aircraft", "Firefighting aircraft ✈")}
      <div className="lgrp">Risk — choropleth</div>
      {radio("none", "None")}
      {radio("activity", "Fire activity")}
      {radio("danger1", <>Forest fire danger +1 day <span className="mfsrc">MF</span></>)}
      {radio("danger2", <>Forest fire danger +2 days <span className="mfsrc">MF</span></>)}
      {radio("vigilance", <>Warnings <span className="mfsrc">MF</span></>)}
      <div className="lgrp">Weather</div>
      {box("wind", "Wind (animation)")}
      {box("rain", "Rain (radar)", "RainViewer radar — native detail to zoom 10, interpolated beyond")}
      {box("air", "Air quality (PM2.5)")}
      <div className="lgrp">Basemap</div>
      {box("labels", "Labels")}
      {box("satellite", "Satellite")}
    </div>
  );
}
