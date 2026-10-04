import {canonicalUrl,coverageCategory,searchExa} from './discovery.mjs';
import {hash,iso,safeUrl,archiveDocument,appendObservation} from './store.mjs';

export const SOCIAL_DOMAINS=['x.com','twitter.com','facebook.com','instagram.com','tiktok.com','reddit.com','bsky.app'];
export const VIDEO_DOMAINS=['youtube.com','youtu.be','dailymotion.com','tiktok.com'];
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const region=/\b(Iran|Iranian|Hormuz|Persian Gulf|Gulf of Oman|Oman|Kuwait|Bahrain|Qatar|Saudi Arabia|United Arab Emirates|Iraq)\b|إيران|ايران|ایران|هرمز|عمان|الخليج|خلیج|العراق|عراق|قطر|البحرين|بحرین|الكويت|کویت|الإمارات|امارات|السعودية|عربستان/i;
const subject=/\b(attack\w*|strik\w*|struck|war|conflict|military|tanker\w*|shipping|maritime|ceasefire|negotiat\w*|sanction\w*|humanitarian|displace\w*|security|diplomacy)\b|حمله|هجوم|جنگ|حرب|ناقل|کشتی|سفین|سفينة|ملاحة|مذاکر|مفاوض|آتش.?بس|وقف إطلاق|قصف|صاروخ|موشک|نزوح|إنسانية/i;
export function socialIdentity(value){
 const safe=canonicalUrl(value);if(!safe)return null;
 const u=new URL(safe);u.hostname=u.hostname.replace(/^(www|m|mobile)\./,'');
 const h=u.hostname,p=u.pathname;
 let platform=null,author=null,video=false;
 if(['x.com','twitter.com'].includes(h)&&/^\/[^/]+\/status\/\d+/.test(p)){u.hostname='x.com';u.pathname=p.match(/^\/[^/]+\/status\/\d+/)[0];platform='X';author='@'+p.split('/')[1];u.search='';}
 if(h==='bsky.app'&&/^\/profile\/[^/]+\/post\/[^/]+/.test(p)){platform='Bluesky';author='@'+p.split('/')[2];u.search='';}
 if(h==='reddit.com'&&/^\/(?:r\/[^/]+\/)?comments\/[^/]+/.test(p)){platform='Reddit';const m=p.match(/^\/(?:r\/[^/]+\/)?comments\/([^/]+)/);u.pathname='/comments/'+m[1];u.search='';}
 if(h==='instagram.com'&&/^\/(p|reel|reels)\/[^/]+/.test(p)){platform='Instagram';video=!p.startsWith('/p/');u.search='';}
 if(h==='facebook.com'&&(/\/(posts|videos|reel)\//.test(p)||['/permalink.php','/story.php','/photo.php','/watch/'].includes(p))){platform='Facebook';video=/videos|reel|watch/.test(p);for(const k of [...u.searchParams.keys()])if(!['story_fbid','id','fbid','v'].includes(k))u.searchParams.delete(k);}
 if(h==='tiktok.com'&&/^\/@[^/]+\/video\/\d+/.test(p)){platform='TikTok';author=p.split('/')[1];video=true;u.search='';}
 if(h==='youtube.com'||h==='youtu.be'){
 const id=h==='youtu.be'?p.slice(1).split('/')[0]:u.searchParams.get('v')||p.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
 if(id&&/^[\w-]{11}$/.test(id)){platform='YouTube';video=true;u.hostname='www.youtube.com';u.pathname='/watch';u.search='?v='+id;}
 }
 if(h==='dailymotion.com'&&/^\/video\/[\w]+/.test(p)){platform='Dailymotion';video=true;u.pathname=p.match(/^\/video\/[\w]+/)[0];u.search='';}
 return platform?{url:u.href,platform,author,feedType:video?'video':'social'}:null;
}
function postText(r,identity){
 const lines=String(r.text||r.highlights?.join(' ')||'').split('\n').map(clean).filter(Boolean);
 const kept=[];
 for(const line of lines){
  if(identity.platform==='Bluesky'&&/^(?:\d{1,2}:\d{2}\s*[AP]M\s*·|\d{4}-\d{2}-\d{2}T)/i.test(line))break;
  if(line===clean(r.title)||line===identity.author||line===clean(r.author)||/^@(\S+)$/.test(line)||/^(Author|Published|Source|Language):/.test(line)||/^#+\s/.test(line))continue;
  kept.push(line);
 }
 return kept.join(' ');
}
const clip=(value,length)=>value.length>length?value.slice(0,length-1).replace(/\s+\S*$/,'')+'…':value;
export function parseSocialReports(results,now=new Date().toISOString()){
 const seen=new Set();
 return results.flatMap(r=>{
  const identity=socialIdentity(r.url),title=clean(r.title),body=identity?postText(r,identity):'',hay=title+' '+body;
  if(!identity||!title||!region.test(hay)||!subject.test(hay)||!r.publishedDate||!Number.isFinite(Date.parse(r.publishedDate)))return [];
  const publishedAt=iso(r.publishedDate);if(publishedAt>now||seen.has(identity.url))return [];seen.add(identity.url);
  let category=coverageCategory(hay);
  if(/هرمز|ناقل|کشتی|سفينة|ملاحة/.test(hay))category='maritime';
  else if(/مذاکر|مفاوض|آتش.?بس|وقف إطلاق/.test(hay))category='diplomacy';
  else if(/نزوح|إنسانية/.test(hay))category='humanitarian';
  return [{...identity,sourceId:'social-iran-gulf',externalId:hash(identity.url),domain:'war',topic:'iran-gulf',kind:'signal',title:clip(/^(Post by @|@.* on Bluesky)/i.test(title)&&body?body:title,100),summary:'Public post discovered through Exa. Claims and media have not been independently verified. Publication time is not the time of the reported event. Original wording is retained.',excerpt:clip(body,280),image:safeUrl(r.image)||null,author:clean(r.author).slice(0,100)||identity.author,publisher:identity.platform,publishedAt,occurredAt:publishedAt,status:'unverified',category,lat:null,lon:null,location:'Iran & Gulf · location not independently established',precision:'not-geolocated',dateBasis:'publication',discoveredVia:'Exa'}];
 });
}
export const SOCIAL_QUERIES=[
 {query:'Iran Hormuz Gulf of Oman tanker attacks war ceasefire',includeDomains:SOCIAL_DOMAINS},
 {query:'إيران مضيق هرمز الخليج هجوم ناقلات حرب مفاوضات',includeDomains:SOCIAL_DOMAINS},
 {query:'ایران تنگه هرمز خلیج حمله کشتی جنگ مذاکره',includeDomains:SOCIAL_DOMAINS},
 {query:'Iran Hormuz tanker attack ceasefire video إيران هرمز ایران',includeDomains:VIDEO_DOMAINS},
];
export async function collectSocial(db,source,options={}){
 const now=options.now||new Date().toISOString(),day=now.slice(0,10);let added=0;const seen=new Set();
 for(const query of SOCIAL_QUERIES){
  const payload={...query,type:'auto',numResults:8,startPublishedDate:new Date(Date.parse(day)-7*86400e3).toISOString(),endPublishedDate:day+'T23:59:59.999Z',contents:{text:{maxCharacters:1200}}};
  const results=await searchExa(db,payload,{...options,now});const records=parseSocialReports(results,now).filter(o=>{if(seen.has(o.url))return false;seen.add(o.url);return true;});
  const doc=archiveDocument(db,source.id,'https://api.exa.ai/search',{query:query.query,results:records,excluded:results.length-records.length},now);
  added+=db.transaction(()=>records.reduce((n,o)=>n+appendObservation(db,o,doc,now),0))();
 }
 return added;
}