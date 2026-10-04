import {hash,archiveDocument} from './store.mjs';
export const PORTWATCH_URL='https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
export const PORTWATCH_PAGE='https://portwatch.imf.org/datasets/3da2b9ca97684916b75c4013f95d18ab_0/about';
export function parsePortWatch(data, now=new Date().toISOString()) {
  if(data.error || !Array.isArray(data.features))throw new Error('Invalid PortWatch response');
  const days=new Set();
  return data.features.map(f=>{
    const a=f.attributes;
    if(a?.portid!=='chokepoint6'||a.portname!=='Strait of Hormuz')throw new Error('Unexpected PortWatch chokepoint');
    const day=typeof a.date==='number'?new Date(a.date).toISOString().slice(0,10):a.date;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>now.slice(0,10)||days.has(day))throw new Error('Invalid or duplicate PortWatch date');
    days.add(day);
    for(const key of ['n_total','n_tanker','n_cargo'])if(a[key]!==null&&(!Number.isInteger(a[key])||a[key]<0))throw new Error('Invalid PortWatch transit count');
    if(a.n_total!==null && a.n_tanker!==null && a.n_cargo!==null && a.n_tanker+a.n_cargo!==a.n_total)throw new Error('Inconsistent PortWatch transit counts');
    return {date:day,total:a.n_total,tankers:a.n_tanker,cargo:a.n_cargo};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function appendTraffic(db, rows, now=new Date().toISOString()) {
  return db.transaction(()=>{
    let added=0;
    for(const r of rows){const payload=JSON.stringify(r),checksum=hash(payload);const previous=db.prepare('SELECT checksum FROM traffic_observations WHERE series=? AND day=? ORDER BY id DESC LIMIT 1').get('hormuz',r.date);
      if(previous?.checksum===checksum)continue;
      db.prepare('INSERT INTO traffic_observations(series,day,recorded_at,checksum,payload) VALUES (?,?,?,?,?)').run('hormuz',r.date,now,checksum,payload);added++;
    }return added;
  })();
}
export async function collectPortWatch(db,source,get){
  const p=new URLSearchParams({f:'json',where:"portid = 'chokepoint6'",outFields:'date,portid,portname,n_total,n_tanker,n_cargo',orderByFields:'date DESC',resultRecordCount:'120',returnGeometry:'false'});
  const url=PORTWATCH_URL+'?'+p,rows=parsePortWatch(JSON.parse(await get(url)));
  if(!rows.length)throw new Error('PortWatch returned no observations');
  const added=appendTraffic(db,rows);archiveDocument(db,source.id,url,{rows,source:PORTWATCH_PAGE,window:'Latest 120 source observations'});return added;
}
export function readTraffic(db,at,knownAt){
  const rows=db.prepare(`WITH versions AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY series,day ORDER BY id DESC) rank FROM traffic_observations WHERE series='hormuz' AND recorded_at<=?) SELECT * FROM versions WHERE rank=1 AND day<=? ORDER BY day DESC LIMIT 90`).all(knownAt,at.slice(0,10));
  return {series:'hormuz',sourceUrl:PORTWATCH_PAGE,publisher:'IMF PortWatch',unit:'AIS-derived vessel transits per day',points:rows.reverse().map(r=>({...JSON.parse(r.payload),recordedAt:r.recorded_at})),method:'Daily AIS-derived estimates. Non-broadcasting vessels may be absent. Missing dates are gaps, not zero traffic. Revisions are archived; data can lag behind today.'};
}
