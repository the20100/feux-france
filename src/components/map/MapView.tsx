"use client";

/**
 * Carte principale. Leaflet reste impératif : ce composant possède la carte
 * via une ref et synchronise chaque couche (modules ./layers) quand les props
 * changent.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import {
  type MapCtx, renderHotspots, renderHeat, renderMarkersAndHulls, renderChoro,
  renderStations, drawCone, syncWind, syncRain, syncAir, syncAircraft,
} from "./layers";
import type { Cluster } from "../format";
import type { LayerState } from "../LayersPanel";

type Props = {
  clusters: Cluster[];
  fires: any[];
  layers: LayerState;
  choro: string;
  tlCursor: number | null;
  selected: Cluster | null;
  selectedWeather: any;
  mfForets: any;
  mfVig: any;
  onSelect: (c: Cluster) => void;
  onDeptClick: (nom: string) => void;
  onAirLegend: (visible: boolean) => void;
};

export default function MapView(props: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<MapCtx | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // -------- création de la carte (une fois)
  useEffect(() => {
    const map = L.map(divRef.current!, { zoomControl: false }).setView([46.4, 2.6], 6);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const baseDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OSM © CARTO · NASA FIRMS · Météo-France · Open-Meteo · Exa",
      maxZoom: 19,
    }).addTo(map);
    const baseSat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri World Imagery", maxZoom: 19 });
    // StrictMode (dev) démonte/remonte l'effet : ne pas ajouter la couche
    // si la carte a été détruite entre-temps
    let disposed = false;
    fetch("/france-metropole.geojson").then((r) => r.json()).then((gj) => {
      if (!disposed)
        L.geoJSON(gj, { style: { color: "#324250", weight: 1, fill: false, opacity: 0.8 } }).addTo(map);
    }).catch(() => {});

    const ctx: MapCtx = {
      map,
      canvasRenderer: L.canvas({ padding: 0.05 }),
      hotspotLayer: L.layerGroup().addTo(map),
      hullLayer: L.layerGroup().addTo(map),
      markerLayer: L.layerGroup().addTo(map),
      coneLayer: L.layerGroup().addTo(map),
      stationsLayer: L.layerGroup(),
      aircraftLayer: L.layerGroup(),
      deptLayer: null, heatLayer: null, windLayer: null, rainLayer: null,
      airLayer: null, deptGeo: null,
    };
    ctxRef.current = ctx;
    (ctx as any)._baseDark = baseDark;
    (ctx as any)._baseSat = baseSat;

    // re-densification des points au franchissement du seuil de zoom
    let lastZoom = map.getZoom();
    map.on("zoomend", () => {
      const z = map.getZoom();
      if ((z <= 7) !== (lastZoom <= 7)) {
        const p = propsRef.current;
        renderHotspots(ctx, p.fires, p.tlCursor, p.layers.hotspots);
      }
      lastZoom = z;
    });

    // onglet caché → coupe la couche de particules (elle utilise setTimeout)
    const onVis = () => {
      document.body.classList.toggle("paused", document.hidden);
      const p = propsRef.current;
      if (document.hidden) syncWind(ctx, false, null);
      else syncWind(ctx, p.layers.wind, p.tlCursor);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      map.remove();
      ctxRef.current = null;
    };
  }, []);

  const ctx = () => ctxRef.current;

  // -------- synchronisation des couches
  useEffect(() => {
    const c = ctx();
    if (c) renderHotspots(c, props.fires, props.tlCursor, props.layers.hotspots);
  }, [props.fires, props.tlCursor, props.layers.hotspots]);

  useEffect(() => {
    const c = ctx();
    if (c) renderHeat(c, props.fires, props.tlCursor, props.layers.heat);
  }, [props.fires, props.tlCursor, props.layers.heat]);

  useEffect(() => {
    const c = ctx();
    if (c) renderMarkersAndHulls(c, props.clusters, {
      showHulls: props.layers.hulls, showLabels: props.layers.labels,
      selectedId: props.selected?.id ?? null, onSelect: props.onSelect,
    });
  }, [props.clusters, props.layers.hulls, props.layers.labels, props.selected?.id]);

  useEffect(() => {
    const c = ctx();
    if (c) renderChoro(c, props.choro, props.clusters, props.mfForets, props.mfVig, props.onDeptClick);
  }, [props.choro, props.clusters, props.mfForets, props.mfVig]);

  useEffect(() => {
    const c = ctx();
    if (c) renderStations(c, props.clusters, props.layers.stations);
  }, [props.clusters, props.layers.stations]);

  useEffect(() => {
    const c = ctx();
    if (c) drawCone(c, props.selected, props.selectedWeather);
  }, [props.selected, props.selectedWeather]);

  // vent : suit le toggle et l'heure du curseur
  const windHour = Math.floor((props.tlCursor ?? Date.now() / 1000) / 3600);
  useEffect(() => {
    const c = ctx();
    if (c) syncWind(c, props.layers.wind, props.tlCursor);
  }, [props.layers.wind, windHour]);

  useEffect(() => {
    const c = ctx();
    if (c) syncRain(c, props.layers.rain);
  }, [props.layers.rain]);

  useEffect(() => {
    const c = ctx();
    if (c) syncAir(c, props.layers.air).then(props.onAirLegend);
  }, [props.layers.air]);

  // aéronefs : toggle + heure timeline + rafraîchissement 2 min en direct
  useEffect(() => {
    const c = ctx();
    if (!c) return;
    syncAircraft(c, props.layers.aircraft, props.tlCursor);
    if (!props.layers.aircraft || props.tlCursor !== null) return;
    const iv = setInterval(() => syncAircraft(c, true, null), 120000);
    return () => clearInterval(iv);
  }, [props.layers.aircraft, windHour]);

  // fond satellite
  useEffect(() => {
    const c = ctx() as any;
    if (!c) return;
    if (props.layers.satellite) {
      c.map.removeLayer(c._baseDark); c._baseSat.addTo(c.map);
    } else {
      c.map.removeLayer(c._baseSat); c._baseDark.addTo(c.map);
    }
  }, [props.layers.satellite]);

  // zoom sur la sélection
  useEffect(() => {
    const c = ctx();
    const s = props.selected;
    if (!c || !s) return;
    if (s.hull.length >= 3)
      c.map.flyToBounds(L.latLngBounds(s.hull.map((p) => [p[1], p[0]] as [number, number])).pad(1.5),
        { maxZoom: 11 });
    else c.map.flyTo([s.lat, s.lon], 10);
  }, [props.selected?.id]);

  return <div id="map" ref={divRef} />;
}
