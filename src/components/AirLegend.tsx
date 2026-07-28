"use client";

export default function AirLegend({ visible }: { visible: boolean }) {
  return (
    <div id="airlegend" className={visible ? "on" : ""}>
      <div className="t">Qualité de l'air — AQI européen</div>
      <div className="bar" />
      <div className="ticks"><span>0</span><span>35</span><span>65</span><span>100</span><span>130+</span></div>
      <div className="lvls"><span>bon (invisible)</span><span>dégradé</span><span>extrême</span></div>
    </div>
  );
}
