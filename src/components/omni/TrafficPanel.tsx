'use client';
import {useState} from 'react';
import {dateLabel,type Traffic} from './types';
export default function TrafficPanel({traffic}:{traffic:Traffic|null|undefined}) {
  const [hover,setHover]=useState<string|null>(null);
  if(!traffic?.points.length)return <section className="omni-traffic"><p className="omni-section-label">STRAIT OF HORMUZ / TRAFFIC</p><p>No traffic observations archived for this date and knowledge mode. Missing data does not mean zero transits.</p></section>;
  const points=traffic.points,latest=points.at(-1)!,selected=points.find(p=>p.date===hover)||latest;
  const start=Date.parse(points[0].date),end=Date.parse(latest.date),day=86400e3,days=Math.round((end-start)/day)+1;
  const ceiling=Math.max(1,...points.map(p=>p.total??0)),left=27,plot=238,bar=Math.max(1,plot/days*.72);
  const x=(date:string)=>left+(Date.parse(date)-start)/day*plot/days;
  const y=(value:number)=>104-value/ceiling*78;
  const week=points.filter(p=>Date.parse(p.date)>end-7*day);
  const mean=week.length===7&&week.every(p=>p.total!==null)?week.reduce((n,p)=>n+p.total!,0)/7:null;
  return <section className="omni-traffic" aria-label="Strait of Hormuz vessel transits">
    <p className="omni-section-label">STRAIT OF HORMUZ / TRAFFIC</p>
    <div className="omni-traffic-reading"><b>{selected.total??'—'}</b><span>AIS-derived transits<br/><time>{dateLabel(selected.date)}</time></span></div>
    <svg viewBox="0 0 280 133" role="img" aria-label={`Daily AIS-derived transits from ${dateLabel(points[0].date)} to ${dateLabel(latest.date)}. Latest: ${latest.total??'missing'}.`} onMouseLeave={()=>setHover(null)}>
      {[0,ceiling].map(v=><g key={v}><line x1={left} x2={269} y1={y(v)} y2={y(v)} stroke="currentColor" opacity=".2"/><text x={21} y={y(v)+3} textAnchor="end">{v}</text></g>)}
      {points.filter(p=>p.total!==null).map(p=><rect key={p.date} x={x(p.date)} y={y(p.total!)} width={bar} height={Math.max(1,104-y(p.total!))} fill={p.date===selected.date?'#e0c586':'#8fa88d'} onMouseEnter={()=>setHover(p.date)}><title>{dateLabel(p.date)}: {p.total} transits, {p.tankers??'unknown'} tankers</title></rect>)}
      <text x={left} y={124}>{dateLabel(points[0].date)}</text><text x={269} y={124} textAnchor="end">{dateLabel(latest.date)}</text>
    </svg>
    <dl><dt>Tankers / cargo</dt><dd>{selected.tankers??'—'} / {selected.cargo??'—'}</dd><dt>Latest 7-day mean</dt><dd>{mean===null?'Incomplete week':`${mean.toFixed(1)} / day`}</dd><dt>Source data through</dt><dd>{dateLabel(latest.date)}</dd></dl>
    <p className="omni-fineprint">{traffic.method}</p>
    <a href={traffic.sourceUrl} target="_blank" rel="noreferrer">IMF PortWatch · source data ↗</a>
    <details><summary>View daily values</summary><table><caption>AIS-derived transits per day</caption><thead><tr><th scope="col">Date</th><th scope="col">Total</th><th scope="col">Tankers</th></tr></thead><tbody>{[...points].reverse().map(p=><tr key={p.date}><th scope="row">{dateLabel(p.date)}</th><td>{p.total??'—'}</td><td>{p.tankers??'—'}</td></tr>)}</tbody></table></details>
  </section>;
}
