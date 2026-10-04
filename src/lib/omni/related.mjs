// Reading aid only: headline similarity never promotes a report to confirmed.
const stop=new Set('the a an in on at of to and or for with from after as by is are iran gulf says said new latest report reports news'.split(' '));
const terms=s=>new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(t=>t.length>2&&!stop.has(t)));
export function relatedCoverage(selected, observations) {
  if(!selected)return [];
  const selectedTime=Date.parse(selected.publishedAt);if(!Number.isFinite(selectedTime))return [];
  const a=terms(selected.title);
  return observations.filter(o=>{
    if(o.id===selected.id||o.topic!==selected.topic||!Number.isFinite(Date.parse(o.publishedAt))||Math.abs(Date.parse(o.publishedAt)-selectedTime)>3*86400e3)return false;
    const b=terms(o.title),overlap=[...a].filter(t=>b.has(t)).length;
    return overlap>=4&&overlap/new Set([...a,...b]).size>=.5;
  }).slice(0,6);
}
