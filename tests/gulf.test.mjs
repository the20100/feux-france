import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGulfNews,syncSources} from '../src/lib/omni/collect.mjs';
import {openStore,readDashboard} from '../src/lib/omni/store.mjs';
const item=(title,date='26 Sep 2026 12:00:00 GMT',link='https://news.un.org/en/story/2026/09/example')=>`<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
const feed=items=>`<rss><channel>${items}</channel></rss>`;
test('Gulf reports are relevant, dated, attributed and never invented point incidents',()=>{
 const xml=feed(item('Saudi Arabia warns over Gulf security')+item('Gaza humanitarian appeal')+item('Iran cultural festival')+item('Iran attacks','invalid')+item('Iran attacks','26 Sep 2027 12:00:00 GMT')+item('Iran attacks',undefined,'https://example.com/story'));
 const records=parseGulfNews(xml,'2026-10-04T00:00:00Z');assert.equal(records.length,1);assert.equal(records[0].status,'reported');assert.equal(records[0].lat,null);assert.equal(records[0].topic,'iran-gulf');assert.equal(records[0].occurredAt,records[0].publishedAt);
});
test('Gulf collection is idempotent and failed refresh retains history',async()=>{
 const db=openStore(':memory:');try{
 const opts={only:'un-news-iran-gulf',force:true,get:async()=>feed(item('Iran and Gulf maritime security'))};
 assert.equal((await syncSources(db,opts))[0].added,1);assert.equal((await syncSources(db,opts))[0].added,0);
 assert.equal((await syncSources(db,{...opts,get:async()=>{throw Error('offline')}}))[0].status,'error');
 assert.equal(readDashboard(db,{domain:'war',topic:'iran-gulf'}).observations.length,1);
 }finally{db.close()}
});
