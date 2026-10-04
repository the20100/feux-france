"use client";

export default function AirLegend({ visible }: { visible: boolean }) {
  return (
    <div id="airlegend" className={visible ? "on" : ""}>
      <div className="t">Air quality — European AQI</div>
      <div className="bar" />
      <div className="ticks"><span>0</span><span>35</span><span>65</span><span>100</span><span>130+</span></div>
      <div className="lvls"><span>good (invisible)</span><span>moderate</span><span>extreme</span></div>
    </div>
  );
}
