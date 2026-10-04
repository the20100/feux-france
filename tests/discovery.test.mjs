import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore,readDashboard} from '../src/lib/omni/store.mjs';
import {canonicalUrl,parseExaReports,parseUkmtoReports,reserveExaCall,searchExa,collectDiscovery} from '../src/lib/omni/discovery.mjs';
import {parsePortWatch,appendTraffic,readTraffic} from '../src/lib/omni/traffic.mjs';
import {relatedCoverage} from '../src/lib/omni/related.mjs';
const now='2026-10-04T22:00:00.000Z';
const article={title:'Tanker attacked in Strait of Hormuz',url:'https://example.com/incident?utm_source=feed',publishedDate:'2026-10-04T12:00:00Z'};
const response=results=>({ok:true,json:async()=>({results,costDollars:{total:.007}})});
test('discovery deduplicates tracking URLs and rejects undated, future and unrelated reports',()=>{
 const items=parseExaReports([article,{...article,url:'https://example.com/incident'}, {...article,publishedDate:null},{...article,publishedDate:'2027-01-01'}, {...article,title:'Cultural exhibition in Iran'}, {...article,url:'javascript:alert(1)'}],now);
 assert.equal(items.length,1);assert.equal(items[0].url,'https://example.com/incident');assert.equal(items[0].lat,null);assert.equal(items[0].status,'reported');assert.equal(items[0].dateBasis,'publication');assert.equal(canonicalUrl('https://news.un.org/feed/view/en/story/2026/1'),'https://news.un.org/en/story/2026/1');
});
test('UKMTO extracts explicit report time without inventing incident coordinates or attackers',()=>{
 const text='UKMTO WARNING 149-26 - ATTACK Report Date: Report Time: Issue Date: Source 02 Oct 2026 2142UTC 02 Oct 2026 Master UKMTO has received a report of an incident 4nm east of Oman. Authorities are investigating.';
 const r={title:'[PDF] UKMTO WARNING',url:'https://www.ukmto.org/-/media/ukmto/products/20261002-ukmto_warning_149_26.pdf?rev=abcd',text};
 const [o]=parseUkmtoReports([r],now);assert.equal(o.reportedAt,'2026-10-02T21:42:00.000Z');assert.equal(o.reference,'149-26');assert.equal(o.location,'4nm east of Oman');assert.equal(o.lat,null);assert.equal(o.status,'reported');assert.equal(o.eventAt,undefined);assert.equal(o.publishedAt,'2026-10-02T00:00:00.000Z');
 assert.equal(parseUkmtoReports([{...r,url:'https://other.example/20261002.pdf'}],now).length,0);
 assert.equal(parseUkmtoReports([{...r,url:'https://www.ukmto.org/advisory.pdf',text:'Iran maritime advisory references an event on 01 March 2026'}],now).length,0);
});
test('daily Exa reservations persist, block overspend and roll over in UTC',()=>{
 const db=openStore(':memory:');try{
 reserveExaCall(db,{now,budget:.02});reserveExaCall(db,{now,budget:.02});assert.throws(()=>reserveExaCall(db,{now,budget:.02}),/budget reached/);
 reserveExaCall(db,{now:'2026-10-05T00:00:00.000Z',budget:.02});assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_spend').get().n,3);
 assert.throws(()=>reserveExaCall(db,{now,budget:0}),/disabled/);
 }finally{db.close()}
});
test('successful Exa requests use shared cache and failed requests keep reservation',async()=>{
 const db=openStore(':memory:');try{
 let calls=0;const opts={now,key:'test',request:async()=>{calls++;return response([article])}};
 await searchExa(db,{query:'test'},opts);await searchExa(db,{query:'test'},opts);assert.equal(calls,1);
 await assert.rejects(searchExa(db,{query:'different'},{...opts,request:async()=>{throw Error('timeout')}}),/timeout/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_spend').get().n,2);assert.equal(db.prepare('SELECT SUM(reserved_micros) n FROM discovery_spend').get().n,20000);
 }finally{db.close()}
});
test('four discovery searches archive a repeated URL once and cache repeated runs',async()=>{
 const db=openStore(':memory:');try{
 let calls=0;const source={id:'exa-iran-gulf',connector:'exa'};
 const opts={now,key:'test',request:async()=>{calls++;return response([article])}};
 assert.equal(await collectDiscovery(db,source,opts),1);assert.equal(await collectDiscovery(db,source,opts),0);assert.equal(calls,4);
 assert.equal(readDashboard(db,{domain:'war',topic:'iran-gulf'}).observations.length,1);
 }finally{db.close()}
});
const row=(date,total=4)=>({attributes:{date,portid:'chokepoint6',portname:'Strait of Hormuz',n_total:total,n_tanker:total===null?null:1,n_cargo:total===null?null:total-1}});
test('PortWatch preserves missing values, validates origin, rejects malformed counts',()=>{
 assert.equal(parsePortWatch({features:[row('2026-09-27',null)]},now)[0].total,null);
 assert.throws(()=>parsePortWatch({features:[row('2026-09-27'),row('2026-09-27')]},now),/duplicate/);
 assert.throws(()=>parsePortWatch({features:[row('2026-02-31')]},now),/date/);
 assert.throws(()=>parsePortWatch({features:[row('2027-01-01')]},now),/date/);
 assert.throws(()=>parsePortWatch({features:[row('2026-09-27',-1)]},now),/count/);
 assert.throws(()=>parsePortWatch({features:[{attributes:{...row('2026-09-27').attributes,portid:'another'}}]},now),/chokepoint/);
});
test('traffic revisions respect valid date and knowledge date without overwriting history',()=>{
 const db=openStore(':memory:');try{
 const rows=parsePortWatch({features:[row('2026-09-26'),row('2026-09-27')]},now);
 assert.equal(appendTraffic(db,rows,'2026-09-28T00:00:00.000Z'),2);assert.equal(appendTraffic(db,rows,now),0);
 appendTraffic(db,[{...rows[1],total:5,cargo:4}],now);
 assert.equal(readTraffic(db,now,'2026-09-29T00:00:00.000Z').points.at(-1).total,4);
 assert.equal(readTraffic(db,now,now).points.at(-1).total,5);
 assert.equal(readTraffic(db,'2026-09-26T23:59:59.999Z',now).points.length,1);
 assert.equal(readTraffic(db,now,'2026-09-20T00:00:00.000Z').points.length,0);
 }finally{db.close()}
});
test('related coverage is a reading aid and does not merge unrelated events or alter status',()=>{
 const a={...article,publishedAt:article.publishedDate,id:1,topic:'iran-gulf',status:'reported',title:'Two tankers struck by drones near Oman coast'};
 const b={...a,id:2,title:'Two tankers struck by drones near Oman coast, officials say'};
 const c={...a,id:3,title:'Diplomatic talks open in Tehran'};
 const old={...b,id:4,publishedAt:'2026-08-01'};
 assert.deepEqual(relatedCoverage(a,[a,b,c,old]).map(x=>x.id),[2]);assert.equal(b.status,'reported');
});
