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
      <div className="t">Couches</div>
      <div className="lgrp">Observé</div>
      {box("hulls", "Contours des foyers")}
      {box("hotspots", "Points chauds")}
      {box("heat", "Heatmap")}
      {box("stations", "Vent mesuré (stations)")}
      {box("aircraft", "Bombardiers d'eau ✈")}
      <div className="lgrp">Risque — choroplèthe</div>
      {radio("none", "Aucune")}
      {radio("activity", "Activité feux")}
      {radio("danger1", <>Danger forêts J+1 <span className="mfsrc">MF</span></>)}
      {radio("danger2", <>Danger forêts J+2 <span className="mfsrc">MF</span></>)}
      {radio("vigilance", <>Vigilance <span className="mfsrc">MF</span></>)}
      <div className="lgrp">Météo</div>
      {box("wind", "Vent (animation)")}
      {box("rain", "Pluie (radar)", "Radar RainViewer — détail natif jusqu'au zoom 10, lissé au-delà")}
      {box("air", "Qualité de l'air (PM2.5)")}
      <div className="lgrp">Fond</div>
      {box("labels", "Étiquettes")}
      {box("satellite", "Satellite")}
    </div>
  );
}
