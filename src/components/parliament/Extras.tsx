'use client';
import * as d3 from 'd3';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Bill, Cosign, Galaxy, Lobby} from './types';
import {cap, photo, scrutinPage} from './types';

const tc = (c?: string) => c ? `color-mix(in srgb, ${c} 55%, #ffffff)` : undefined;
const nf = (n: number) => n.toLocaleString('en-GB');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
function Count({v, suffix = ''}: {v: number; suffix?: string}) {
  const [n, setN] = useState(0);
  useEffect(() => { let raf = 0; const t0 = performance.now(); const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1300); setN(Math.round(v * (1 - Math.pow(1 - k, 4)))); if (k < 1) raf = requestAnimationFrame(tick); }; tick(); return () => cancelAnimationFrame(raf); }, [v]);
  return <>{nf(n)}{suffix}</>;
}

/* ================= amendments: co-signature map ================= */
export function CosignSidebar({co, data, selected, onPick}: {co: Cosign; data: Galaxy; selected: number | null; onPick: (i: number) => void}) {
  const g = new Map(data.groups.map(x => [x.id, x.color]));
  return <>
    <div className="omni-sidebar-top">
      <div className="omni-section-label">Pairs who sign across groups <span>{co.pairs.length}</span></div>
      <p className="parl-muted" style={{margin: '8px 0 0'}}>Deputies from different groups who put their names on the same amendments most often.</p>
    </div>
    <div className="omni-record-list">{co.pairs.map(([i, j, n], k) => <button key={k} className="x-pair" aria-pressed={selected === i || selected === j} onClick={() => onPick(i)}>
      <span><i style={{background: g.get(data.deputies[i].group)}} />{data.deputies[i].name}<small>{data.deputies[i].group}</small></span>
      <span><i style={{background: g.get(data.deputies[j].group)}} />{data.deputies[j].name}<small>{data.deputies[j].group}</small></span>
      <b>{n}</b>
    </button>)}</div>
  </>;
}
export function CosignDetail({co, data, selected, onPick}: {co: Cosign; data: Galaxy; selected: number | null; onPick: (i: number) => void}) {
  const g = new Map(data.groups.map(x => [x.id, x.color]));
  const d = selected != null ? data.deputies[selected] : null, s = selected != null ? co.dep[selected] : null;
  const cross = co.groups.filter(([a, b]) => a !== b).slice(0, 10), max = cross[0]?.[2] || 1;
  return <div className="parl-card" key={selected ?? 'all'}>
    {d && s ? <>
      <div className="parl-card-head"><img src={photo(d.id)} alt="" width={64} height={64} loading="lazy" /><div><h2>{d.name}</h2><p><span className="parl-chip" style={{background: g.get(d.group)}}>{d.group}</span> {d.dept}</p></div></div>
      <dl className="parl-stats">
        <div><dt>Amendments tabled</dt><dd>{nf(s.a)}</dd></div>
        <div><dt>Co-signed</dt><dd>{nf(s.c)}</dd></div>
        <div><dt>Adopted</dt><dd>{nf(s.ad)}</dd></div>
      </dl>
      <p className="parl-muted">{nf(s.x)} of these carry a signature from another group.</p>
      <div className="omni-section-label">Signs most often with</div>
      <ul className="parl-near">{s.top.map(([j, n]) => <li key={j}><button onClick={() => onPick(j)}><span className="omni-topic-dot" style={{background: g.get(data.deputies[j].group)}} />{data.deputies[j].name}<small>{data.deputies[j].group}</small><b>{nf(n)}</b></button></li>)}</ul>
    </> : <>
      <h2>Who signs with whom</h2>
      <dl className="parl-stats">
        <div><dt>Amendments</dt><dd><Count v={co.total} /></dd></div>
        <div><dt>Co-signed</dt><dd><Count v={Math.round(co.withCo / co.total * 100)} suffix="%" /></dd></div>
        <div><dt>Across groups</dt><dd><Count v={co.cross} /></dd></div>
      </dl>
      <p className="parl-muted">Stars sit where their co-signatures pull them. Gold links cross group lines. Click a star to see a deputy's signing partners.</p>
      <div className="omni-section-label">Groups that sign together most</div>
      <div className="x-bars">{cross.map(([a, b, n]) => <div key={a + b}><span><b style={{color: tc(g.get(a))}}>{a}</b> + <b style={{color: tc(g.get(b))}}>{b}</b></span><i><u style={{width: `${n / max * 100}%`}} /></i><em>{nf(n)}</em></div>)}</div>
    </>}
    <p className="parl-source">Source: <a href={co.source.url} target="_blank" rel="noreferrer">{co.source.name}</a>, {co.source.license}. {co.method}</p>
  </div>;
}

/* ================= bills: step-by-step tracker ================= */
const CH_COLOR: Record<string, string> = {AN: '#5b98ff', 'Sénat': '#ffcf7a', CMP: '#b79cff', 'Conseil constitutionnel': '#7fe0ff', Promulgation: '#3fe6b4', Other: '#9fb0d4'};
const day = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
export function Bills({onForecast}: {onForecast: () => void}) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [src, setSrc] = useState<{name: string; url: string; license: string} | null>(null);
  const [q, setQ] = useState(''); const [f, setF] = useState<'all' | 'open' | 'done'>('all'); const [sel, setSel] = useState(0);
  useEffect(() => { fetch('/parliament/bills.json').then(r => r.json()).then(j => { setBills(j.bills); setSrc(j.source); }).catch(() => setBills([])); }, []);
  const list = useMemo(() => (bills || []).map((b, i) => ({b, i})).filter(({b}) => (f === 'all' || (f === 'done') === b.done) && (!q || norm(b.title).includes(norm(q)))), [bills, q, f]);
  if (!bills) return <div className="omni-map-loading">Loading the bills…</div>;
  const b = bills[sel];
  return <div className="x-bills">
    <aside className="x-bills-list">
      <div className="omni-sidebar-top">
        <div className="omni-section-label">Bills moving since 2025 <span>{list.length}</span></div>
        <input className="omni-search" placeholder="Search a bill…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search bills" />
        <div className="parl-seg" style={{marginTop: 12}}>{([['all', 'All'], ['open', 'In progress'], ['done', 'Promulgated']] as const).map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
      </div>
      <div className="omni-record-list">{list.slice(0, 200).map(({b, i}) => <button key={b.uid} className="x-bill-row" aria-pressed={i === sel} onClick={() => setSel(i)}>
        <small>{day(b.last)} · <b className={b.done ? 'ok' : ''}>{b.status}</b>{b.live ? <em> · {b.live} live forecasts</em> : null}</small>
        <span>{b.title}</span>
        <div className="x-dots">{b.stages.map((s, k) => <i key={k} style={{background: CH_COLOR[s.chamber] || CH_COLOR.Other}} title={s.label} />)}</div>
      </button>)}</div>
    </aside>
    {b && <section className="x-bill" key={b.uid}>
      <p className="x-kicker">{b.procedure}</p>
      <h2>{b.title}</h2>
      <div className="x-bill-meta">
        <span className={b.done ? 'ok' : ''}>{b.status}</span>
        <span>last step {day(b.last)}</span>
        {b.amendments && <span>{nf(b.amendments.n)} amendments, {nf(b.amendments.adopted)} adopted, {nf(b.amendments.cross)} signed across groups</span>}
        {b.votes > 0 && <span>{b.votes} recorded divisions</span>}
      </div>
      {b.live > 0 && <button className="x-live" onClick={onForecast}><i />Orcet has {b.live} live forecasts on this bill. Open them in Forecast.</button>}
      <div className="x-track" style={{gridTemplateColumns: `repeat(${b.stages.length}, minmax(190px, 1fr))`}}>
        <div className="x-rail"><i style={{animationDuration: `${0.5 + b.stages.length * 0.35}s`}} /></div>
        {b.stages.map((s, k) => <div key={k} className="x-stage" style={{animationDelay: `${0.15 + k * 0.28}s`, ['--c' as string]: CH_COLOR[s.chamber] || CH_COLOR.Other}}>
          <span className="x-node" />
          <small>{s.chamber}</small>
          <b>{s.label}</b>
          <time>{day(s.start)}{s.end !== s.start ? ` to ${day(s.end)}` : ''}</time>
          {s.outcome && <em>{/rejet/i.test(s.outcome) ? 'Rejected' : /adopt/i.test(s.outcome) ? 'Adopted' : cap(s.outcome)}</em>}
          {s.final.map(v => <a key={v.n} href={scrutinPage(v.n)} target="_blank" rel="noreferrer" className="x-vote"><span className={v.sort === 'adopté' ? 'ok' : 'ko'}>{v.sort === 'adopté' ? 'Adopted' : 'Rejected'}</span> {v.pour} for, {v.contre} against</a>)}
          {!s.final.length && s.votes.length > 0 && <a href={scrutinPage(s.votes[s.votes.length - 1])} target="_blank" rel="noreferrer" className="x-vote">{s.votes.length} recorded division{s.votes.length > 1 ? 's' : ''} ↗</a>}
        </div>)}
      </div>
      <div className="x-links">
        {b.an && <a href={b.an} target="_blank" rel="noreferrer">Assemblée file ↗</a>}
        {b.senat && <a href={b.senat} target="_blank" rel="noreferrer">Senate file ↗</a>}
      </div>
      {src && <p className="parl-source">Source: <a href={src.url} target="_blank" rel="noreferrer">{src.name}</a>, {src.license}. Steps and dates come from the Assemblée's legislative files, Senate steps included as the Assemblée records them.</p>}
    </section>}
  </div>;
}

/* ================= lobbying register ================= */
export function Interests() {
  const [l, setL] = useState<Lobby | null>(null);
  const [q, setQ] = useState(''); const [dom, setDom] = useState<string | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => { fetch('/parliament/lobby.json').then(r => r.json()).then(setL).catch(() => {}); }, []);
  useEffect(() => {
    if (!l || !ref.current) return;
    const W = 720, H = 460, svg = d3.select(ref.current); svg.selectAll('*').remove();
    const root = d3.pack<{label: string; acts: number; orgs: number}>().size([W, H]).padding(5)(d3.hierarchy({children: l.domains} as never).sum((d: never) => (d as {acts: number}).acts || 0) as never);
    const max = d3.max(l.domains, d => d.acts) || 1, col = d3.scaleLinear<string>().domain([0, max]).range(['#27418f', '#7fb0ff']);
    const node = svg.selectAll('g').data(root.leaves()).join('g').attr('transform', d => `translate(${d.x},${d.y})`).style('cursor', 'pointer')
      .on('click', (_, d) => setDom(x => x === d.data.label ? null : d.data.label));
    node.append('circle').attr('r', 0).attr('fill', d => col(d.data.acts)).attr('fill-opacity', .32).attr('stroke', d => col(d.data.acts)).attr('stroke-width', 1.4)
      .transition().delay((_, i) => i * 35).duration(900).ease(d3.easeElasticOut.amplitude(1).period(.55)).attr('r', d => d.r);
    node.append('text').attr('text-anchor', 'middle').attr('dy', '-.1em').attr('fill', '#eef3ff').style('font-size', d => `${Math.max(10, Math.min(17, d.r / 4.2))}px`).style('font-weight', 600).style('pointer-events', 'none')
      .text(d => d.r > 30 ? (d.data.label.length > d.r / 3.6 ? d.data.label.slice(0, Math.floor(d.r / 3.6)) + '…' : d.data.label) : '').attr('opacity', 0).transition().delay((_, i) => 400 + i * 35).attr('opacity', 1);
    node.append('text').attr('text-anchor', 'middle').attr('dy', '1.25em').attr('fill', '#b4ccff').style('font-size', '11px').style('pointer-events', 'none').text(d => d.r > 38 ? nf(d.data.acts) : '').attr('opacity', 0).transition().delay((_, i) => 500 + i * 35).attr('opacity', 1);
    node.append('title').text(d => `${d.data.label}: ${nf(d.data.acts)} activities, ${nf(d.data.orgs)} organisations`);
  }, [l]);
  const orgs = useMemo(() => (l?.orgs || []).filter(o => (!dom || o.domains.includes(dom)) && (!q || norm(o.name).includes(norm(q)))), [l, q, dom]);
  if (!l) return <div className="omni-map-loading">Reading the register…</div>;
  const tmax = l.targets[0]?.n || 1, cmax = d3.max(l.categories, c => c.acts) || 1;
  return <div className="ins-grid x-lobby">
    <div className="ins-kpis" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
      <div className="ins-kpi"><b><Count v={l.registered} /></b><small>organisations in the HATVP register</small></div>
      <div className="ins-kpi"><b><Count v={l.active} /></b><small>declared activity aimed at Parliament since 2024</small></div>
      <div className="ins-kpi"><b><Count v={l.parlActs} /></b><small>activity sheets naming deputies, senators or their staff</small></div>
      <div className="ins-kpi"><b><Count v={l.plfssTotal} /></b><small>organisations that declared work on the social security budget</small></div>
    </div>
    <section className="ins-card"><h3>What they lobby Parliament about</h3><p>Bubble size is the number of activity sheets aimed at Parliament. Click a theme to filter the list below.</p><svg ref={ref} viewBox="0 0 720 460" className="ins-svg" />{dom && <p className="ins-tip">Filtered on: <b>{dom}</b> <button className="x-clear" onClick={() => setDom(null)}>clear</button></p>}</section>
    <section className="ins-card"><h3>Who they approach</h3><p>Public officials named in the declared actions, all activity since 2024.</p>
      <div className="x-bars">{l.targets.map((t, k) => <div key={t.label} style={{animationDelay: `${k * 60}ms`}}><span>{t.label}</span><i><u style={{width: `${t.n / tmax * 100}%`}} /></i><em>{nf(t.n)}</em></div>)}</div>
      <h3 style={{marginTop: 26}}>Who does the lobbying</h3><p>Activity sheets aimed at Parliament, by type of organisation.</p>
      <div className="x-bars">{l.categories.slice(0, 8).map((c, k) => <div key={c.label} style={{animationDelay: `${k * 60}ms`}}><span>{c.label}</span><i><u style={{width: `${c.acts / cmax * 100}%`}} /></i><em>{nf(c.acts)}</em></div>)}</div>
    </section>
    <section className="ins-card wide"><h3>Most active organisations towards Parliament</h3><p>Ranked by activity sheets filed since 2024. Spending is the last yearly bracket each organisation declared.</p>
      <input className="omni-search" placeholder="Search an organisation…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search organisations" style={{maxWidth: 420}} />
      <div className="x-table"><div className="x-th"><span>Organisation</span><span>Type</span><span>Main themes</span><span>Declared spending</span><span>Sheets</span></div>
        {orgs.slice(0, 60).map((o, k) => <a key={o.url} href={o.url} target="_blank" rel="noreferrer" className="x-tr" style={{animationDelay: `${Math.min(k, 14) * 30}ms`}}><span>{o.name}</span><span>{o.cat}</span><span>{o.domains.join(', ')}</span><span>{o.spend ? o.spend.replace(/> = /g, '').replace(/ euros/g, ' €').replace(' et < ', ' to ') : 'not declared'}</span><b>{nf(o.acts)}</b></a>)}
        {!orgs.length && <p className="parl-muted">No organisation matches.</p>}</div>
    </section>
    <section className="ins-card wide"><h3>Declared lobbying on the social security budget</h3><p>Organisations whose 2025 and 2026 activity sheets name the PLFSS and list parliamentarians among the people approached. The register does not say which ones.</p>
      <div className="x-plfss">{l.plfss.slice(0, 24).map((o, k) => <a key={o.url} href={o.url} target="_blank" rel="noreferrer" style={{animationDelay: `${Math.min(k, 14) * 40}ms`}}><b>{o.name}</b><small>{o.cat} · {o.n} sheet{o.n > 1 ? 's' : ''}</small><span>{o.objects[0]}</span></a>)}</div>
      <p className="parl-source">Source: <a href={l.source.url} target="_blank" rel="noreferrer">{l.source.name}</a>, {l.source.license}. {l.method}</p>
    </section>
  </div>;
}
