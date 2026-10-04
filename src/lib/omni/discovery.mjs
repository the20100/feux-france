import { randomUUID } from 'node:crypto';
import {hash,iso,safeUrl,archiveDocument,appendObservation} from './store.mjs';

export const EXA_QUERIES = [
  ['maritime','Iran Strait of Hormuz Persian Gulf Gulf of Oman tanker shipping maritime attacks latest developments'],
  ['hostilities','Iran Iraq Gulf states military strikes attacks civilian casualties latest developments'],
  ['diplomacy','Iran Gulf Hormuz ceasefire negotiations diplomacy sanctions latest developments'],
  ['humanitarian','Iran Gulf conflict humanitarian displacement hospitals civilian impact latest developments'],
];
const text = value => String(value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const geography = /\b(?:Iran(?:ian)?(?![- ]backed)|Hormuz|Persian Gulf|Gulf of Oman|Gulf (?:states|region)|Oman|Kuwait|Bahrain|Qatar|Saudi Arabia|United Arab Emirates|Iraq)\b/i;
const security = /\b(?:attack\w*|strik\w*|struck|war|conflict|military|civilian\w*|tanker\w*|shipping|maritime|ceasefire|negotiat\w*|sanction\w*|humanitarian|displace\w*|hostilities|security|nuclear|diplomacy)\b/i;
export function canonicalUrl(value) {
  const url = safeUrl(value); if (!url) return null;
  const u = new URL(url); if(u.username || u.password) return null;
  u.hash='';
  if(u.hostname==='news.un.org')u.pathname=u.pathname.replace('/feed/view/en/story/','/en/story/');
  for(const k of [...u.searchParams.keys()]) if(/^utm_|^(fbclid|gclid|ref|ref_src)$/i.test(k) || (u.hostname.endsWith('ukmto.org') && k==='rev'))u.searchParams.delete(k);
  u.searchParams.sort();return u.href;
}
export function coverageCategory(title) {
  if(/\b(tanker|vessel|shipping|maritime|Hormuz|navigation|ship)\b/i.test(title))return 'maritime';
  if(/\b(ceasefire|negotiat\w*|diplomac\w*|sanction\w*|talks|peace|deal)\b/i.test(title))return 'diplomacy';
  if(/\b(humanitarian|displac\w*|hospital\w*|hunger|aid|refugee\w*)\b/i.test(title))return 'humanitarian';
  return 'hostilities';
}
export function parseExaReports(results, now = new Date().toISOString()) {
  const seen = new Set();
  return results.flatMap(r=>{
    const title=text(r.title),url=canonicalUrl(r.url),body=text(r.text || r.highlights?.join(' '));
    if(!url || !title || !geography.test(`${title} ${body}`) || !security.test(`${title} ${body}`))return [];
    if(!r.publishedDate || !Number.isFinite(Date.parse(r.publishedDate)))return [];
    const publishedAt=iso(r.publishedDate);
    if(publishedAt>now || seen.has(url))return [];seen.add(url);
    const publisher=new URL(url).hostname.replace(/^www\./,'');
    return [{sourceId:'exa-iran-gulf',externalId:hash(url),domain:'war',topic:'iran-gulf',kind:'bulletin',title,url,publishedAt,occurredAt:publishedAt,status:'reported',publisher,category:coverageCategory(title),location:'Iran & Gulf · location not independently established',lat:null,lon:null,precision:'not-geolocated',dateBasis:'publication',summary:'Article discovered through Exa. The title describes the publisher’s report, not an independently verified incident. The timeline uses the publication date; the event date and exact location have not been established.',discoveredVia:'Exa'}];
  });
}
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function documentDate(day,month,year) {
  const m=MONTHS[month.toLowerCase().slice(0,3)];if(!m)return null;
  const s=`${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s ? s+'T00:00:00.000Z' : null;
}
export function parseUkmtoReports(results, now=new Date().toISOString()) {
  return results.flatMap(r=>{
    const url=canonicalUrl(r.url);if(!url||!['ukmto.org','www.ukmto.org'].includes(new URL(url).hostname)||!new URL(url).pathname.toLowerCase().endsWith('.pdf'))return [];
    const body=text(r.text);if(!geography.test(body+' '+r.title))return [];
    const fileDate=new URL(url).pathname.match(/\/(20\d{2})(\d{2})(\d{2})[-_]/);
    const produced=body.match(/\bPRODUCED\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i);
    // Flattened warning form: report date/time then issue date. Do not infer a
    // publication date from an arbitrary date in a multi-incident advisory.
    const form=body.match(/Report Date:\s*Report Time:\s*Issue Date:\s*Source\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\s+(\d{4})\s*UTC\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i);
    let publishedAt=form?documentDate(form[5],form[6],form[7]):produced?documentDate(produced[1],produced[2],produced[3]):fileDate?`${fileDate[1]}-${fileDate[2]}-${fileDate[3]}T00:00:00.000Z`:null;
    if(!publishedAt && r.publishedDate && Number.isFinite(Date.parse(r.publishedDate)))publishedAt=iso(r.publishedDate);
    if(!publishedAt || !Number.isFinite(Date.parse(publishedAt)) || publishedAt>now)return [];
    let reportTime=null;
    if(form){const d=documentDate(form[1],form[2],form[3]),h=Number(form[4].slice(0,2)),m=Number(form[4].slice(2));if(d && h<24 && m<60)reportTime=d.replace('00:00:00',`${form[4].slice(0,2)}:${form[4].slice(2)}:00`);}
    if(reportTime && reportTime>now)return [];
    const warning=/UKMTO WARNING/i.test(body),ref=warning?body.match(/\b(\d{1,3})[-_](\d{2})\s*[-–]\s*(ATTACK|SUSPICIOUS ACTIVITY|APPROACH)/i):null;
    const location=body.match(/report of an incident\s+([^.!?]{4,100})[.!?]/i)?.[1] || 'Iran & Gulf · regional advisory';
    const title=ref?`UKMTO ${ref[1]}-${ref[2]} · ${ref[3].toLowerCase()}`:text(r.title).replace(/^\[PDF\]\s*/,'');
    return [{sourceId:'ukmto-iran-gulf',externalId:hash(url),domain:'war',topic:'iran-gulf',kind:'bulletin',title,url,publishedAt,occurredAt:reportTime||publishedAt,reportedAt:reportTime,status:'reported',publisher:'UKMTO',category:'maritime',location,lat:null,lon:null,precision:'not-geolocated',dateBasis:reportTime?'source-report-time':'document-issue-date',reference:ref?`${ref[1]}-${ref[2]}`:null,summary:warning?'Official UKMTO warning reporting a maritime incident. The location wording is taken from the document; no exact coordinates or responsible actor are inferred. Consult the original for investigation status and updates.':'Official UKMTO maritime overview or advisory. Aggregate traffic and security statements are not individual incident counts. Consult the original for the covered period and methodology.',discoveredVia:'Exa · official UKMTO document',contentHash:hash(body)}];
  }).sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
}
export function reserveExaCall(db, {now=new Date().toISOString(), budget=Number(process.env.OMNI_EXA_DAILY_BUDGET_USD || 1),maxCalls=120}={}) {
  const day=now.slice(0,10),limit=Math.floor(budget*1e6),reserve=10000;
  if(!Number.isFinite(limit)||limit<reserve)throw new Error('Exa daily budget is disabled or invalid');
  return db.transaction(()=>{
    const used=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(MAX(reserved_micros,COALESCE(actual_micros,0))),0) spent FROM discovery_spend WHERE day=?').get(day);
    if(used.n>=maxCalls||used.spent+reserve>limit)throw new Error('Exa daily budget reached; archived reports remain available');
    const id=randomUUID();db.prepare('INSERT INTO discovery_spend(id,day,started_at,reserved_micros) VALUES (?,?,?,?)').run(id,day,now,reserve);return id;
  }).immediate();
}
export async function searchExa(db, payload, {request=fetch,now=new Date().toISOString(),key=process.env.EXA_API_KEY}={}) {
  if(!key)throw new Error('Exa API key is not configured');
  // Cache a stable daily search window; do not include a changing current time
  // in its key. Successful results are reused for one hour, even across workers.
  const cacheKey=hash(payload),cached=db.prepare('SELECT * FROM discovery_cache WHERE key=?').get(cacheKey);
  if(cached && +new Date(now)-+new Date(cached.fetched_at)<3600000)return JSON.parse(cached.payload);
  const id=reserveExaCall(db,{now});
  const response=await request('https://api.exa.ai/search',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error(`Exa HTTP ${response.status}`);
  const data=await response.json();
  if(!Array.isArray(data.results))throw new Error('Invalid Exa response');
  if(Number.isFinite(data.costDollars?.total)&&data.costDollars.total>=0)db.prepare('UPDATE discovery_spend SET actual_micros=? WHERE id=?').run(Math.ceil(data.costDollars.total*1e6),id);
  db.prepare('INSERT INTO discovery_cache(key,fetched_at,payload) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at,payload=excluded.payload').run(cacheKey,now,JSON.stringify(data.results));
  return data.results;
}
export async function collectDiscovery(db, source, options={}) {
  const now=options.now||new Date().toISOString(),day=now.slice(0,10);
  const start=new Date(Date.parse(day)-(source.connector==='ukmto-exa'?35:30)*86400e3).toISOString();
  const month=new Date(now).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const queries=source.connector==='ukmto-exa'?[['official',`UKMTO WARNING ${month} Strait of Hormuz Gulf of Oman tanker attack`]]:EXA_QUERIES;
  let added=0;
  for(const [,query] of queries){
    const payload={query,type:'auto',numResults:8,startPublishedDate:start,endPublishedDate:day+'T23:59:59.999Z',contents:{text:{maxCharacters:7000}}};
    if(source.connector==='ukmto-exa')payload.includeDomains=['ukmto.org'];
    const results=await searchExa(db,payload,{...options,now});
    const records=source.connector==='ukmto-exa'?parseUkmtoReports(results,now):parseExaReports(results,now);
    if(source.connector==='ukmto-exa'&&!records.length)throw new Error('No dated official UKMTO documents found; archived notices retained');
    const doc=archiveDocument(db,source.id,'https://api.exa.ai/search',{query,results:records,excluded:results.length-records.length},now);
    added+=db.transaction(()=>records.reduce((n,o)=>n+appendObservation(db,o,doc,now),0))();
  }
  return added;
}
