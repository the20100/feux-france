'use client';
import TrafficPanel from './TrafficPanel';
import {relatedCoverage} from '@/lib/omni/related.mjs';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useState} from 'react';
import type {DashboardData,Domain,Observation} from './types';
import {dateLabel,statusLabels} from './types';
const WorldMap=dynamic(()=>import('./WorldMap'),{ssr:false,loading:()=> <div className="omni-map-loading">Loading map…</div>});
const names={global:'A view of the world.',pandemic:'Health surveillance.',war:'Conflicts & territories.'};
const subtitles={global:'Fires, health signals and conflict theatres on one timeline.',pandemic:'Distinguish signals, reports and confirmed counts.',war:'Monitored conflict theatres. Dated reports and territorial assessments; coverage is not exhaustive.'};
const EMPTY:any[]=[];
export default function Dashboard({domain}:{domain:Domain}) {
  const [data,setData]=useState<DashboardData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [topic,setTopic]=useState(''),[at,setAt]=useState(''),[mode,setMode]=useState('revised'),[query,setQuery]=useState(''),[status,setStatus]=useState('all'),[category,setCategory]=useState('all');
  const [ready,setReady]=useState(false),[selected,setSelected]=useState<Observation|null>(null),[sourcesOpen,setSourcesOpen]=useState(false),[playing,setPlaying]=useState(false),[refresh,setRefresh]=useState(0);
  const [versions,setVersions]=useState<Observation[]|null>(null),[versionError,setVersionError]=useState('');
  const [fires,setFires]=useState<any[]>([]),[fireState,setFireState]=useState('loading');
  useEffect(()=>{
    const p=new URLSearchParams(window.location.search);setTopic(p.get('topic')||'');setAt(/^\d{4}-\d{2}-\d{2}$/.test(p.get('at')||'')?p.get('at')!:'');setMode(p.get('mode')==='known'?'known':'revised');setQuery(p.get('q')||'');setStatus(p.get('status')||'all');setCategory(p.get('category')||'all');setReady(true);
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const p=new URLSearchParams();if(topic)p.set('topic',topic);if(at)p.set('at',at);if(mode==='known')p.set('mode',mode);if(query)p.set('q',query);if(status!=='all')p.set('status',status);if(category!=='all')p.set('category',category);
    const url=window.location.pathname+(p.size?'?'+p.toString():'');window.history.replaceState(null,'',url);
    try{sessionStorage.setItem(`omni-url-${domain}`,url);}catch{}
  },[ready,domain,topic,at,mode,query,status,category]);
  useEffect(()=>{
    if(!ready)return;
    const controller=new AbortController();setLoading(true);setError('');
    const p=new URLSearchParams({domain});if(topic)p.set('topic',topic);
    if(at){p.set('at',`${at}T23:59:59.999Z`);if(mode==='known')p.set('knownAt',`${at}T23:59:59.999Z`);}
    fetch(`/api/omni?${p}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error((await r.json()).error||'Unable to load data');return r.json();}).then(d=>{setData(d);setSelected(old=>d.observations.find(o=>o.id===old?.id)||null);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[domain,topic,at,mode,ready,refresh]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setRefresh(r=>r+1);},60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(domain!=='global'||at){setFires([]);return;}
    const c=new AbortController();setFireState('loading');fetch('/api/clusters?range=24h',{signal:c.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{setFires(d.clusters||[]);setFireState('ok');}).catch(e=>{if(e.name!=='AbortError'){setFires([]);setFireState('error');}});return()=>c.abort();
  },[domain,at]);
  const allTopics=data?.topics||EMPTY;
  const panelTopics=useMemo(()=>allTopics.filter(t=>domain==='global'||t.domain===domain),[allTopics,domain]);
  const currentTopic=panelTopics.find(t=>t.id===topic);
  const observations=useMemo(()=>(data?.observations||[]).filter(o=>(status==='all'||o.status===status)&&(category==='all'||o.category===category)&&(!query||`${o.title} ${o.publisher} ${o.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))),[data,status,query,category]);
  const days=useMemo(()=>[...new Set((data?.timeline||[]).map(d=>d.slice(0,10)))].sort(),[data?.timeline]);
  const sliderIndex=at ? Math.max(0,days.reduce((last,d,i)=>d<=at?i:last,-1)) : days.length;
  useEffect(()=>{
    if(!playing||!days.length)return;
    const timer=setTimeout(()=>{const next=at?days.find(d=>d>at):days[0];if(next)setAt(next);else{setPlaying(false);setAt('');}},1600);
    return()=>clearTimeout(timer);
  },[playing,at,days]);
  const selectTopic=useCallback((id:string)=>{setTopic(id);setCategory('all');setSelected(null);setVersions(null);setPlaying(false);},[]);
  const selectObservation=useCallback((o:Observation)=>{setSelected(o);setVersions(null);setVersionError('');setSourcesOpen(false);},[]);
  useEffect(()=>{setVersions(null);setVersionError('');},[selected?.id]);
  const related=useMemo(()=>relatedCoverage(selected,data?.observations||[]),[selected,data]);
  const health=data?.sources.filter(s=>s.health==='ok').length||0;
  const territory=data?.territories.find(t=>t.metadata.topic===(topic||'ukraine'));
  const sourceCount=data?.sources.filter(s=>s.health!=='reference'&&s.health!=='manual').length||0;
  async function loadVersions(){
    if(!selected)return;const id=selected.id;setVersionError('');
    try{const r=await fetch(`/api/omni?history=${id}`);if(!r.ok)throw new Error();const result=await r.json();setVersions(result.versions);}catch{setVersionError('History unavailable. Please try again.');}
  }
  return <section className={`omni-dashboard omni-${domain}`}>
    <div className="omni-heading">
      <div><p className="omni-eyebrow">{domain==='global'?'OVERVIEW':domain==='pandemic'?'02 / PANDEMIC':'03 / WAR'}</p><h1>{names[domain]}</h1><p className="omni-subtitle">{subtitles[domain]}</p></div>
      <div className="omni-heading-actions"><span className="omni-freshness">{at?'ARCHIVE': 'LATEST RECORDS'}<small>{data?`Retrieved at ${new Date(data.fetchedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`:'Connecting to the archive…'}</small></span><button onClick={()=>setSourcesOpen(v=>!v)} aria-pressed={sourcesOpen}>Sources <b>{health}/{sourceCount}</b></button><button className="omni-refresh" onClick={()=>setRefresh(r=>r+1)} disabled={loading} aria-label="Refresh data">↻</button></div>
    </div>
    {error&&<div role="alert" className="omni-alert">{error}. The displayed data may be out of date. <button onClick={()=>{setTopic('');setRefresh(r=>r+1);}}>Try again</button></div>}
    <div className="omni-workspace">
      <aside className="omni-sidebar" aria-label="Topics and publications">
        <div className="omni-sidebar-top"><div className="omni-section-label">EXPLORE <span>{panelTopics.length} topics</span></div>
          <label className="omni-field"><span>{domain==='pandemic'?'Disease':domain==='war'?'Theatre':'Topic'}</span><select value={topic} onChange={e=>selectTopic(e.target.value)}><option value="">All topics</option>{panelTopics.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <input className="omni-search" aria-label="Search publications" placeholder="Search publications…" value={query} onChange={e=>setQuery(e.target.value)}/>
          <div className="omni-status-filter"><label htmlFor="omni-status">Show</label><select id="omni-status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="unverified">Unverified signals</option><option value="reported">Publications</option><option value="contained">Contained outbreaks</option></select></div>
          {(domain==='war'||domain==='global')&&topic==='iran-gulf'&&<label className="omni-status-filter"><span>Coverage</span><select aria-label="Coverage category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All coverage</option><option value="maritime">Maritime security</option><option value="hostilities">Hostilities</option><option value="diplomacy">Diplomacy</option><option value="humanitarian">Humanitarian impact</option></select></label>}
        </div>
        <div className="omni-record-list" aria-busy={loading}>
          {!topic&&!query&&<div className="omni-topic-list">{panelTopics.map(t=><button key={t.id} onClick={()=>selectTopic(t.id)}><span className={`omni-topic-dot ${t.domain}`}/><span>{t.name}<small>{t.region}</small></span><span>↗</span></button>)}</div>}
          <div className="omni-section-label omni-list-label">PUBLICATIONS <span>{observations.length}{data?.truncated?'+':''}</span></div>
          {loading&&!data?<p className="omni-empty">Loading history…</p>:observations.length===0?<p className="omni-empty">No publications in this selection. This does not mean there are no cases or conflicts.{mode==='known'&&at?' The information may not have been archived by this date.':''}</p>:observations.map(o=><button className={`omni-record ${selected?.id===o.id?'selected':''}`} key={o.id} onClick={()=>selectObservation(o)}><div className="omni-record-meta"><span className={`omni-badge ${o.status}`}>{statusLabels[o.status]||o.status}</span><time dateTime={o.occurredAt}>{dateLabel(o.occurredAt)}</time></div><strong>{o.title}</strong><span className="omni-record-source">{o.publisher}{o.discoveredVia&&<small> · {o.discoveredVia}</small>}</span></button>)}
        </div>
        <div className="omni-sidebar-foot">{data?.truncated?'The 400 most recent publications. Narrow the topic or date.':'Publications are archived with their sources.'}</div>
      </aside>
      <div className="omni-map-area">
        <WorldMap key={domain} storageKey={domain} topics={panelTopics} observations={observations} territories={data?.territories||EMPTY} topic={topic} onTopic={selectTopic} onSelect={selectObservation} fires={!topic?fires:EMPTY}/>
        {loading&&<div className="omni-map-updating" role="status">Loading period…</div>}
        <div className="omni-map-caption"><span>{currentTopic?.name||'WORLD'}</span><small>{at?`Situation as of ${dateLabel(at)}`:'Latest available data'} · regional markers</small></div>
        <div className="omni-map-legend"><span><i className="health"/>Health</span><span><i className="conflict"/>Monitored theatre</span>{domain==='global'&&<span><i className="fire"/>Fire clusters</span>}{!!data?.territories.length&&<><span><i className="control"/>Assessed control</span><span>┄ Contested / claimed</span></>}</div>
        {domain!=='pandemic'&&territory&&<div className="omni-territory-note">{territory.metadata.publisher} · snapshot dated {dateLabel(territory.metadata.validAt)}<br/><small>Locality cells assessed as RU / contested · not an exact frontline</small></div>}
        {domain!=='pandemic'&&!data?.territories.length&&<div className="omni-territory-note">Territories: no licensed snapshot for this selection.<br/><small>Markers do not represent frontlines.</small></div>}
      </div>
      <aside className="omni-detail" aria-label={sourcesOpen?'Source status':'Topic details'}>
        {sourcesOpen?<><div className="omni-detail-top"><span className="omni-section-label">SOURCE REGISTRY</span><button onClick={()=>setSourcesOpen(false)} aria-label="Close sources">×</button></div><h2>Provenance matters.</h2>{data?.discoveryBudget&&<div className="omni-discovery-budget"><b>Exa discovery budget · {data.discoveryBudget.day} UTC</b><p>{data.discoveryBudget.requests} requests · ${data.discoveryBudget.actualUsd.toFixed(3)} reported cost</p><small>${data.discoveryBudget.budgetUsedUsd.toFixed(2)} reserved / ${data.discoveryBudget.limitUsd.toFixed(2)} daily limit. Pending or failed calls retain their reservation. FIRES usage is separate.</small></div>}<p className="omni-detail-intro">Collection status and freshness. A successful connection does not imply a recent publication.</p>{data?.sources.map(s=><article className="omni-source" key={s.id}><div><span className={`omni-health ${s.health}`}/><a href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a></div><small>{({ok:'Collection successful',error:'Collection unavailable',pending:'Pending',stale:'Refresh needed',reference:'Historical reference',manual:'Manual import / optional feed'})[s.health]||s.health}</small><p>{s.description}</p>{s.error&&<p className="omni-source-error">{s.error}</p>}<dl><dt>Latest data</dt><dd>{dateLabel(s.lastDataAt)}</dd><dt>Last attempt</dt><dd>{dateLabel(s.last_attempt)}</dd><dt>Last success</dt><dd>{dateLabel(s.last_success)}</dd></dl><small>{s.license}</small></article>)}</>:selected?<>
          <div className="omni-detail-top"><span className={`omni-badge ${selected.status}`}>{statusLabels[selected.status]||selected.status}</span><button onClick={()=>setSelected(null)} aria-label="Close details">×</button></div><p className="omni-eyebrow">{panelTopics.find(t=>t.id===selected.topic)?.name}</p><h2>{selected.title}</h2><p className="omni-detail-intro">{selected.summary}</p>
          {selected.metrics&&<div className="omni-metrics"><p>CUMULATIVE COUNT AS OF {dateLabel(selected.metrics.asOf)}</p><div><strong>{selected.metrics.confirmed??'—'}<small>Confirmed</small></strong><strong>{selected.metrics.probable??'—'}<small>Probable</small></strong><strong>{selected.metrics.deaths??'—'}<small>Deaths*</small></strong></div><small>{selected.metrics.scope}. *Deaths are included in case counts; do not add them.</small></div>}
          <dl className="omni-dates"><dt>{selected.dateBasis==='source-report-time'?'Reported to UKMTO':selected.dateBasis==='document-issue-date'?'Document issue date':selected.kind==='bulletin'?'Publication (reference date)':'Reference date'}</dt><dd>{selected.reportedAt?new Date(selected.reportedAt).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC':dateLabel(selected.occurredAt)}</dd><dt>Published by source</dt><dd>{dateLabel(selected.publishedAt)}</dd><dt>Archived in OMNI</dt><dd>{dateLabel(selected.recordedAt)}</dd><dt>Location</dt><dd>{selected.location}</dd><dt>Publisher</dt><dd>{selected.publisher}</dd>{selected.category&&<><dt>Coverage</dt><dd>{selected.category}</dd></>}{selected.discoveredVia&&<><dt>Discovered via</dt><dd>{selected.discoveredVia}</dd></>}{selected.reference&&<><dt>Official reference</dt><dd>{selected.reference}</dd></>}</dl>
          <a className="omni-source-link" href={selected.url} target="_blank" rel="noreferrer">Read source document <span>↗</span></a>
          {!!related.length&&<div className="omni-related"><b>Potentially related coverage</b><p>Similar headlines, not independent confirmation. Reports may repeat the same account.</p>{related.map(o=><button key={o.id} onClick={()=>selectObservation(o)}>{o.title}<small>{o.publisher} · {dateLabel(o.publishedAt)}</small></button>)}</div>}
          <button className="omni-history-button" onClick={loadVersions}>View archived versions ({selected.revisions||1})</button>{versionError&&<p role="alert">{versionError}</p>}{versions&&<div className="omni-versions"><p>Full history, including corrections after the selected date.</p>{versions.map(v=><div key={v.id}><time>{dateLabel(v.recordedAt)}</time><b>{v.title}</b><span>{statusLabels[v.status]||v.status}</span></div>)}</div>}
        </>:<>
          <p className="omni-eyebrow">{currentTopic?'TOPIC':'READING GUIDE'}</p><h2>{currentTopic?.name||'Facts, with context.'}</h2><p className="omni-detail-intro">{currentTopic?.description||'Select a topic or publication. Every record retains its date, provenance and verification status.'}</p>
          <div className="omni-brief-number"><strong>{observations.length}</strong><span>publications in<br/>this selection</span></div>
          {topic==='iran-gulf'&&<TrafficPanel traffic={data?.traffic}/>}
          {domain==='war'&&topic!=='iran-gulf'&&<div className="omni-territory-sources"><b>Territorial control</b>{territory&&<><p>Snapshot dated <strong>{dateLabel(territory.metadata.validAt)}</strong>. {territory.metadata.method}</p>{territory.metadata.changes&&<div className="omni-territory-delta"><b>Since {dateLabel(territory.metadata.changes.since)}</b><p>{territory.metadata.changes.toRU} localities newly assessed as RU · {territory.metadata.changes.fromRU} no longer assessed as RU.</p></div>}<a href={`/api/omni/territory?snapshot=${territory.snapshotId}`} target="_blank" rel="noreferrer">Download GeoJSON snapshot ↗</a><small>{territory.metadata.license}</small></>}<p>Imported snapshots are archived in full. Contested and claimed areas remain distinct from assessed control.</p><a href="https://www.understandingwar.org" target="_blank" rel="noreferrer">Read ISW assessments ↗</a><p>Reusing their geodata requires their written permission.</p></div>}
          <div className="omni-guide"><b>01 / Locate</b><p>Markers indicate a region or theatre. Publications without coordinates remain in the list.</p><b>02 / Replay</b><p>Choose a date. “Known at the time” shows only information already archived by that date.</p><b>03 / Verify</b><p>A suspected case is not a confirmed case. A humanitarian report does not establish a change in control.</p></div>
          {domain==='global'&&<Link className="omni-source-link" href="/feux">Open FIRES <span>↗</span></Link>}{domain==='global'&&<p className="omni-fineprint">{at?'Replay historical fire clusters in the FIRES panel.':fireState==='ok'?`${fires.length} fire clusters loaded for the last 24 h.`:fireState==='error'?'FIRES unavailable in this view; open the dedicated panel.':'Loading fire clusters…'}</p>}

        </>}
      </aside>
    </div>
    <div className="omni-timeline">
      <div className="omni-timeline-title"><span className="omni-eyebrow">TIMELINE / UTC</span><strong>{at?dateLabel(at):'Latest available state'}</strong></div>
      <button onClick={()=>{if(!playing)setAt('');setPlaying(p=>!p);}} disabled={!days.length} aria-label={playing?'Pause replay':'Replay available dates'}>{playing?'Ⅱ':'▶'}</button>
      <div className="omni-timeline-slider"><input type="range" min={0} max={days.length||1} value={sliderIndex} disabled={!days.length} aria-label="Situation date" onChange={e=>{setPlaying(false);setAt(days[Number(e.target.value)]||'');}}/><div><span>{dateLabel(days[0])}</span><span>Latest state</span></div></div>
      <label className="omni-date-picker"><span>Date</span><input aria-label="Choose a date" type="date" value={at} max={new Date().toISOString().slice(0,10)} onInput={e=>{setAt(e.currentTarget.value);setPlaying(false);}} onChange={e=>{setAt(e.target.value);setPlaying(false);}}/></label>
      <select aria-label="Knowledge mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="revised">Revised with current data</option><option value="known">Known at the time</option></select><button onClick={()=>{setAt('');setPlaying(false);}}>Today</button>
    </div>
  </section>;
}
