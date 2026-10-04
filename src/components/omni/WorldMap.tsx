'use client';
import L from 'leaflet';
import { useEffect,useRef } from 'react';
import type { Observation,Topic,Territory } from './types';
import { dateLabel,statusLabels } from './types';
const colours:Record<string,string>={controlled:'#d78876',contested:'#d8b363',claimed:'#b5a6d4'};
export default function WorldMap({topics,observations,territories,topic,onTopic,onSelect,fires,storageKey}:{storageKey:string;topics:Topic[];observations:Observation[];territories:Territory[];topic:string;onTopic:(id:string)=>void;onSelect:(o:Observation)=>void;fires:any[]}) {
  const el=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),group=useRef<L.LayerGroup|null>(null),lastTopic=useRef<string|null>(null);
  useEffect(()=>{
    if(!el.current)return;
    const m=L.map(el.current,{preferCanvas:true,zoomControl:false,minZoom:2,maxZoom:15,worldCopyJump:true}).setView([24,28],2);
    // Bundled public-domain basemap: independent of a tile provider or API key.
    m.createPane('omni-basemap').style.zIndex='200';
    m.createPane('omni-labels').style.zIndex='350';
    m.getPane('omni-labels')!.style.pointerEvents='none';
    const controller=new AbortController();
    let tiled=false;let basemap:L.GeoJSON|null=null;const labels=L.layerGroup();
    fetch('/api/omni/basemap',{signal:controller.signal}).then(r=>r.json()).then(config=>{
      if(!config.available)return;
      const tile=L.tileLayer(config.template,{maxZoom:19,className:'omni-carto-base',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'});
      tile.on('tileload',()=>{tiled=true;if(basemap&&m.hasLayer(basemap))m.removeLayer(basemap);if(m.hasLayer(labels))m.removeLayer(labels);});
      tile.on('tileerror',()=>{if(m.hasLayer(tile))m.removeLayer(tile);tiled=false;if(basemap&&!m.hasLayer(basemap))basemap.addTo(m);});
      tile.addTo(m);
    }).catch(()=>{});
    fetch('/world-countries.geojson',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('Basemap unavailable');return r.json();}).then(world=>{
      basemap=L.geoJSON(world,{pane:'omni-basemap',interactive:false,style:{color:'#415044',weight:.7,fillColor:'#26382e',fillOpacity:1}}).addTo(m);
      if(tiled&&basemap)m.removeLayer(basemap);
      for(const f of world.features){const p=f.properties;if(!Number.isFinite(p.LABEL_X)||!Number.isFinite(p.LABEL_Y))continue;
        const label=document.createElement('span');label.textContent=p.ADMIN;
        L.marker([p.LABEL_Y,p.LABEL_X],{pane:'omni-labels',interactive:false,icon:L.divIcon({className:'omni-country-label',html:label,iconSize:[100,15],iconAnchor:[50,7]})}).addTo(labels);
      }
      const toggle=()=>{if(m.getZoom()>=3&&!tiled){if(!m.hasLayer(labels))labels.addTo(m);}else if(m.hasLayer(labels))m.removeLayer(labels);};m.on('zoomend',toggle);toggle();
    }).catch(e=>{if(e.name!=='AbortError'){const note=document.createElement('div');note.textContent='Basemap unavailable';L.popup().setLatLng(m.getCenter()).setContent(note).openOn(m);}});
    m.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a> · geographic basemap, not territorial control');
    try{const saved=JSON.parse(sessionStorage.getItem(`omni-camera-${storageKey}`)||'null');if(saved&&Number.isFinite(saved.lat)&&Number.isFinite(saved.lon)&&Number.isFinite(saved.zoom))m.setView([saved.lat,saved.lon],saved.zoom);}catch{}
    m.on('moveend',()=>{try{const c=m.getCenter();sessionStorage.setItem(`omni-camera-${storageKey}`,JSON.stringify({lat:c.lat,lon:c.lng,zoom:m.getZoom()}));}catch{}});
    L.control.zoom({position:'bottomright'}).addTo(m);L.control.scale({position:'bottomleft',imperial:false}).addTo(m);
    map.current=m;group.current=L.layerGroup().addTo(m);
    const observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(el.current);
    return()=>{controller.abort();observer.disconnect();m.remove();map.current=null;};
  },[]);
  useEffect(()=>{
    if(lastTopic.current===topic)return;
    if(lastTopic.current===null&&!topic){lastTopic.current=topic;return;}
    const t=topics.find(t=>t.id===topic);
    if(topic&&!t)return;
    lastTopic.current=topic;
    if(t?.lat!=null&&t?.lon!=null)map.current?.setView([t.lat,t.lon],t.zoom,{animate:false});
    else map.current?.setView([24,28],2,{animate:false});
  },[topic,topics]);
  useEffect(()=>{
    const g=group.current;if(!g)return;g.clearLayers();
    for(const snapshot of territories) {
      L.geoJSON(snapshot as any,{style:f=>({color:colours[f?.properties?.status]||'#d78876',weight:f?.properties?.status==='controlled'?0:.7,fillOpacity:0.42,dashArray:f?.properties?.status==='controlled'?undefined:'5 5'}),onEachFeature:(f,layer)=>{
        const node=document.createElement('div');
        const strong=document.createElement('strong');strong.textContent=`${f.properties.name||""} · ${f.properties.actor} · ${statusLabels[f.properties.status]||f.properties.status}`;node.append(strong);
        const text=document.createElement('p');text.textContent=`${snapshot.metadata.publisher} · snapshot dated ${dateLabel(snapshot.metadata.validAt)}. ${snapshot.metadata.license}`;node.append(text);
        const a=document.createElement('a');a.href=snapshot.metadata.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='View source ↗';node.append(a);layer.bindPopup(node);
      }}).addTo(g);
    }
    for(const t of topics.filter(t=>!topic||t.id===topic)) {
      if(t.lat==null||t.lon==null)continue;
      const count=observations.filter(o=>o.topic===t.id).length;
      const marker=L.circleMarker([t.lat,t.lon],{radius:t.id===topic?10:7,color:t.domain==='war'?'#d8b363':'#a2c8ae',weight:1.5,fillOpacity:.2}).addTo(g);
      const label=document.createElement('span');label.textContent=`${t.name} · ${count} publication${count>1?'s':''} · regional marker`;
      marker.bindTooltip(label,{direction:'top',className:'omni-map-label'}).on('click',()=>onTopic(t.id));
    }
    for(const o of observations.filter(o=>o.lat!=null&&o.lon!=null)) {
      const marker=L.circleMarker([o.lat!,o.lon!],{radius:5,color:o.status==='unverified'?'#d8b363':'#a2c8ae',fillOpacity:.85,weight:1}).addTo(g);
      const node=document.createElement('span');node.textContent=`${o.title} · ${o.location}`;
      marker.bindTooltip(node).on('click',()=>onSelect(o));
    }
    for(const f of fires) {
      if(!Number.isFinite(f.lat)||!Number.isFinite(f.lon))continue;
      const marker=L.circleMarker([f.lat,f.lon],{radius:4,color:'#f68b53',fillOpacity:.65,weight:1}).addTo(g);
      const a=document.createElement('a');a.href='/feux';a.textContent=`${f.name||'Fire cluster'} · open FIRES ↗`;marker.bindPopup(a);
    }
  },[topics,observations,territories,topic,onTopic,onSelect,fires]);
  return <div className="omni-world-map" ref={el} aria-label="World map. Regional markers are also accessible in the topic list." role="region"/>;
}
