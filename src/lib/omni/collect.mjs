import {collectDiscovery} from './discovery.mjs';
import {collectPortWatch} from './traffic.mjs';
import { collectViina } from './viina.mjs';
import { XMLParser } from 'fast-xml-parser';
import { sources, topics } from './catalog.mjs';
import { archiveDocument, appendObservation, appendTerritory, claimSource, finishSource, hash, iso, safeUrl, seedReferences } from './store.mjs';

const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const matches = (text, topic) => topic === 'hantavirus' ? /\bhantavirus|\bandes virus/i.test(text) : /\bpneumonic plague|\bbubonic plague|\byersinia pestis|\bhuman plague/i.test(text);

export async function fetchText(url, maxBytes = 8_000_000) {
  const response = await fetch(url, { headers: { 'User-Agent': 'OMNI/1.0 (+https://omni.vima.work)', Accept: 'application/json, application/rss+xml, application/xml, text/xml;q=0.9' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} · ${new URL(url).hostname}`);
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > maxBytes) throw new Error('Response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(()=>{}); }
  return Buffer.concat(chunks).toString('utf8');
}
export function parseReliefWeb(xml, topic) {
  const parsed = parser.parse(xml);
  if (!parsed.rss?.channel) throw new Error('Invalid RSS feed');
  const entries = parsed.rss.channel.item || [];
  return (Array.isArray(entries) ? entries : [entries]).flatMap(item => {
    const title = clean(item.title), url = safeUrl(item.link);
    if (!url || !title || !item.pubDate) return [];
    if (topic.domain === 'pandemic' && !matches(`${title} ${clean(item.description)}`, topic.id)) return [];
    const publishedAt = iso(item.pubDate);
    return [{ sourceId: `reliefweb-${topic.id}`, externalId: hash(url), domain: topic.domain, topic: topic.id, kind: 'bulletin', title, summary: 'Publication indexed by ReliefWeb. Consult the source for content, coverage period and methodology. The displayed date is the publication date.', url, occurredAt: publishedAt, publishedAt, status: 'reported', location: topic.region, lat: null, lon: null, precision: 'not-geolocated', contentHash: hash(String(item.description||'')), publisher: clean(item.author) || 'Publisher indexed by ReliefWeb' }];
  });
}

async function collectReliefWeb(db, source, get) {
  const topic = topics.find(t => t.id === source.topic);
  const search = topic.domain === 'war' ? (topic.countries || [topic.country]).map(country => `country.exact:"${country}"`).join(' OR ') : topic.id === 'hantavirus' ? 'hantavirus' : '"pneumonic plague" OR "bubonic plague"';
  const url = `https://reliefweb.int/updates/rss.xml?${new URLSearchParams({ search })}`;
  const observations = parseReliefWeb(await get(url), topic);
  // Store bibliographic metadata only: no republication of third-party report text.
  const docId = archiveDocument(db,source.id,url,observations);
  return db.transaction(()=>observations.reduce((n,o)=>n+appendObservation(db,o,docId),0))();
}
// Require both regional relevance and a security/humanitarian subject. Never geocode
// an article to the theatre centre: the centre is only a navigation marker.
export function parseGulfNews(xml, now = new Date().toISOString()) {
  const parsed = parser.parse(xml);
  if (!parsed.rss?.channel) throw new Error('Invalid UN News RSS feed');
  const items = parsed.rss.channel.item || [];
  return (Array.isArray(items) ? items : [items]).flatMap(item => {
    const title = clean(item.title), url = safeUrl(item.link);
    const text = `${title} ${clean(item.description)}`;
    if (!/\b(?:Iran(?:ian)?(?![- ]backed)|Hormuz|Persian Gulf|Gulf (?:States|region)|Oman|Kuwait|Bahrain|Qatar|Saudi Arabia|United Arab Emirates|Iraq)\b/i.test(text) || !/\b(?:war|conflict|attack|strike|hostilities|security|military|shipping|maritime|navigation|ceasefire|humanitarian|peace|diplomacy|nuclear|sanction|displaced|civilian|terrorism|tensions)\b/i.test(text)) return [];
    if (!title || !url || new URL(url).hostname !== 'news.un.org' || !item.pubDate || !Number.isFinite(Date.parse(item.pubDate))) return [];
    const publishedAt = iso(item.pubDate);
    if (publishedAt > now) return [];
    return [{sourceId:'un-news-iran-gulf',externalId:hash(url),domain:'war',topic:'iran-gulf',kind:'bulletin',title,summary:'UN News report concerning Iran and Gulf regional security. Consult the original for the reported events, attributed statements and humanitarian context. The timeline uses the publication date; this record does not establish territorial control.',url,occurredAt:publishedAt,publishedAt,status:'reported',location:'Iran & Gulf · regional coverage',lat:null,lon:null,precision:'not-geolocated',publisher:'UN News',contentHash:hash(clean(item.description))}];
  });
}
async function collectGulfNews(db, source, get) {
  const observations = parseGulfNews(await get(source.feedUrl));
  const docId = archiveDocument(db,source.id,source.feedUrl,observations);
  return db.transaction(()=>observations.reduce((n,o)=>n+appendObservation(db,o,docId),0))();
}
async function collectWho(db, source, get) {
  const url = 'https://www.who.int/api/emergencies/diseaseoutbreaknews?$orderby=PublicationDateAndTime%20desc&$top=100';
  const result = JSON.parse(await get(url));
  if (!Array.isArray(result.value) || !result.value.length) throw new Error('Empty WHO response or unexpected format');
  const records = result.value.flatMap(item => {
    const title = clean(item.Title || item.OverrideTitle);
    const topic = ['hantavirus','plague'].find(id => matches(title,id));
    if (!topic) return [];
    const publishedAt = iso(item.PublicationDateAndTime || item.PublicationDate);
    if (+new Date(publishedAt) > Date.now()) return [];
    const slug = item.UrlName;
    if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return [];
    return [{ sourceId: source.id, externalId: String(item.Id), domain:'pandemic',topic,kind:'bulletin',title,summary:'Official WHO bulletin. Read the document for figures and locations; individual cases are not automatically extracted.',url:`https://www.who.int/emergencies/disease-outbreak-news/item/${slug}`,occurredAt:publishedAt,publishedAt,status:'reported',location:'See WHO bulletin',lat:null,lon:null,precision:'not-geolocated',sourceModifiedAt:item.LastModified||null,publisher:'World Health Organization' }];
  });
  const docId = archiveDocument(db,source.id,url,records);
  return db.transaction(()=>records.reduce((n,o)=>n+appendObservation(db,o,docId),0))();
}
async function collectDatagouv(db, source, get) {
  const url = 'https://www.data.gouv.fr/api/1/datasets/6a00e457c5bc7667066b44a2/';
  const data = JSON.parse(await get(url));
  if (!data.id || !Array.isArray(data.resources)) throw new Error('Invalid data.gouv metadata');
  archiveDocument(db,source.id,url,{ id:data.id,title:data.title,organization:data.organization?.name || null, publisher:[data.owner?.first_name,data.owner?.last_name].filter(Boolean).join(' '),updatedAt:data.last_update,license:data.license,resources:data.resources.map(r=>({id:r.id,url:r.url,available:r.extras?.['check:available'],checkedAt:r.extras?.['check:date']})) });
  const unavailable = data.resources.some(r => r.extras?.['check:available'] === false);
  if (unavailable) throw new Error('Catalogue accessible; data.gouv reports the Hantavirus resource as unavailable. No counts imported.');
  return 0;
}
export async function syncSources(db, { force = false, only = null, get = fetchText } = {}) {
  seedReferences(db);
  const results = [];
  for (const source of sources.filter(s=>s.connector && (s.connector !== 'territories' || process.env.OMNI_TERRITORY_FEED_URL) && (!only || s.id === only))) {
    const runId = claimSource(db,source,new Date().toISOString(),force);
    if (!runId) continue;
    try {
      let added = 0;
      if (['exa','ukmto-exa'].includes(source.connector)) added = await collectDiscovery(db,source);
      if (source.connector === 'portwatch') added = await collectPortWatch(db,source,get);
      if (source.connector === 'viina') added = await collectViina(db);
      if (source.connector === 'reliefweb') added = await collectReliefWeb(db,source,get);
      if (source.connector === 'un-news') added = await collectGulfNews(db,source,get);
      if (source.connector === 'who') added = await collectWho(db,source,get);
      if (source.connector === 'datagouv') added = await collectDatagouv(db,source,get);
      if (source.connector === 'territories') {
        if (!process.env.OMNI_TERRITORY_FEED_URL) throw new Error('No licensed territory feed configured. GeoJSON import available.');
        const url = safeUrl(process.env.OMNI_TERRITORY_FEED_URL);
        if (!url?.startsWith('https://')) throw new Error('URL de flux HTTPS requise');
        const data = JSON.parse(await get(url,30_000_000));
        const snapshots = Array.isArray(data) ? data : [data];
        added = db.transaction(()=>snapshots.reduce((n,snapshot)=>n+appendTerritory(db,snapshot),0))();
      }
      finishSource(db,source,runId,added); results.push({source:source.id,added,status:'ok'});
    } catch (e) {
      const error = String(e.message || e).slice(0,500);
      finishSource(db,source,runId,0,error); results.push({source:source.id,added:0,status:'error',error});
    }
  }
  return results;
}
