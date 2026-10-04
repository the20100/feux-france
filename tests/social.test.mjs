import test from 'node:test';
import assert from 'node:assert/strict';
import {socialIdentity,parseSocialReports,collectSocial} from '../src/lib/omni/social.mjs';
import {openStore,readDashboard} from '../src/lib/omni/store.mjs';
const now='2026-10-04T19:00:00.000Z';
const post={title:'Tanker attack near Hormuz',url:'https://twitter.com/reporter/status/123?s=20',publishedDate:'2026-10-04T10:00:00Z',text:'Iran maritime attack report',author:'Reporter'};
test('post URLs reject profiles and hostile hosts, normalize social and video identities',()=>{
 for(const url of ['https://x.com/reporter','https://instagram.com/explore','https://x.com.evil.test/a/status/123','javascript:alert(1)','https://youtube.com/@news'])assert.equal(socialIdentity(url),null);
 assert.equal(socialIdentity(post.url).url,'https://x.com/reporter/status/123');
 assert.equal(socialIdentity('https://youtu.be/abcdefghijk?t=20').url,'https://www.youtube.com/watch?v=abcdefghijk');
 assert.equal(socialIdentity('https://www.reddit.com/r/news/comments/abc/title/?share_id=1').url,'https://reddit.com/comments/abc');
 assert.equal(socialIdentity('https://tiktok.com/@a/video/123').feedType,'video');
});
test('social parser requires dates, relevant claims and individual post URLs; never invents verification or coordinates',()=>{
 const results=parseSocialReports([post,{...post,url:'https://x.com/reporter/status/123'}, {...post,publishedDate:null},{...post,publishedDate:'2027-01-01'}, {...post,url:'https://x.com/profile'}, {...post,title:'Iran travel photography',text:'Beautiful view'}],now);
 assert.equal(results.length,1);const o=results[0];assert.equal(o.status,'unverified');assert.equal(o.lat,null);assert.equal(o.dateBasis,'publication');assert.equal(o.author,'Reporter');assert.equal(o.feedType,'social');
 assert.equal(parseSocialReports([{...post,url:'https://bsky.app/profile/example.com/post/abc',title:'Post by @example.com — Bluesky',text:'A cultural exhibition\n10:00 PM · Oct 3, 2026\nA reply about Iran tanker attack'}],now).length,0);
 assert.equal(parseSocialReports([{...post,title:'إيران هجوم ناقلة في مضيق هرمز',text:''}],now)[0].category,'maritime');
 assert.equal(parseSocialReports([{...post,title:'ایران حمله کشتی در تنگه هرمز',text:''}],now)[0].category,'maritime');
});
test('social collection shares persistent cache and budget, archives corrections and respects knowledge date',async()=>{
 const db=openStore(':memory:');try{
 let calls=0,body='Iran tanker attack';const opts={now,key:'test',request:async()=>{calls++;return {ok:true,json:async()=>({results:[{...post,text:body}],costDollars:{total:.007}})}}};
 const source={id:'social-iran-gulf'};
 assert.equal(await collectSocial(db,source,opts),1);assert.equal(await collectSocial(db,source,opts),0);assert.equal(calls,4);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_spend').get().n,4);
 body='Iran tanker attack corrected';await collectSocial(db,source,{...opts,now:'2026-10-04T21:00:00.000Z'});
 const latest=readDashboard(db,{domain:'war',topic:'iran-gulf'}).observations;assert.equal(latest.length,1);assert.equal(latest[0].revisions,2);
 const historical=readDashboard(db,{domain:'war',topic:'iran-gulf',knownAt:now}).observations;assert.equal(historical[0].excerpt,'Iran tanker attack');
 }finally{db.close()}
});
