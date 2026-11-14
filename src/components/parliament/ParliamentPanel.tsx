'use client';
import dynamic from 'next/dynamic';
import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import type {Forecast, Galaxy} from './types';
import {ForecastDetail, ForecastList, SignalsRadar, TrackRecord} from './Forecast';
const Insights = dynamic(() => import('./Insights'), {ssr: false, loading: () => <div className="omni-map-loading">Crunching the legislature…</div>});
import {BALLOT_LABEL, anPage, cap, pct, photo, scrutinPage} from './types';
// group colours as readable text on the dark background
const tc = (c?: string) => c ? `color-mix(in srgb, ${c} 55%, #ffffff)` : undefined;

const Scene3D = dynamic(() => import('./Scene3D'), {ssr: false, loading: () => <div className="omni-map-loading">Igniting the galaxy…</div>});
type View = 'galaxy' | 'forecast' | 'hemicycle' | 'insights' | 'compare' | 'quiz';
const VIEWS: [View, string, string][] = [['galaxy', 'Vote galaxy', '✦'], ['forecast', 'Forecast', '◉'], ['hemicycle', 'Hemicycle replay', '◠'], ['insights', 'Insights', '▤'], ['compare', 'Compare', '⇄'], ['quiz', 'Vote like…', '?']];
const QUIZ_SIZE = 12;

function readUrl() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function ParliamentPanel() {
  const [data, setData] = useState<Galaxy | null>(null);
  const [agree, setAgree] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('galaxy');
  const [period, setPeriod] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<number | null>(null);
  const [vote, setVote] = useState(0);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [links, setLinks] = useState(true);
  const [rotate, setRotate] = useState(true);
  const [hover, setHover] = useState<{i: number; x: number; y: number} | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [fc, setFc] = useState<Forecast | null>(null);
  const [fcSel, setFcSel] = useState(0);
  const [fcSort, setFcSort] = useState('tension');
  const [overlay, setOverlay] = useState<'track' | 'signals' | null>(null);
  const booted = useRef(false);

  useEffect(() => {
    fetch('/parliament/galaxy.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(setData).catch(e => setError(String(e.message || e)));
    fetch('/parliament/forecast.json').then(r => r.ok ? r.json() : null).then(setFc).catch(() => {});
    fetch('/parliament/agreement.bin').then(r => r.arrayBuffer()).then(b => setAgree(new Uint8Array(b))).catch(() => {});
  }, []);

  // restore state from URL once data is in
  useEffect(() => {
    if (!data || booted.current) return;
    booted.current = true;
    const u = readUrl();
    const v = u.get('view') as View; if (v && VIEWS.some(x => x[0] === v)) setView(v);
    const d = data.deputies.findIndex(x => x.id === u.get('d')); if (d >= 0) setSelected(d);
    const c = data.deputies.findIndex(x => x.id === u.get('vs')); if (c >= 0) setCompare(c);
    const k = data.keyVotes.findIndex(x => String(x.n) === u.get('s')); if (k >= 0) setVote(k);
    if (u.get('g')) setGroup(u.get('g'));
  }, [data]);
  useEffect(() => {
    if (!data || !booted.current) return;
    const u = new URLSearchParams();
    if (view !== 'galaxy') u.set('view', view);
    if (selected != null) u.set('d', data.deputies[selected].id);
    if (compare != null) u.set('vs', data.deputies[compare].id);
    if (view === 'hemicycle') u.set('s', String(data.keyVotes[vote]?.n));
    if (group) u.set('g', group);
    const url = `/parlement${u.size ? `?${u}` : ''}`;
    window.history.replaceState(null, '', url);
    try { sessionStorage.setItem('omni-url-parlement', url); } catch {}
  }, [data, view, selected, compare, vote, group]);

  // timeline playback
  useEffect(() => {
    if (!playing || !data) return;
    const t = setInterval(() => setPeriod(p => { if (p + 1 >= data.periods.length) { setPlaying(false); return p; } return p + 1; }), 2200);
    return () => clearInterval(t);
  }, [playing, data]);

  const agreement = (i: number, j: number) => { if (!agree || !data) return null; const v = agree[i * data.deputies.length + j]; return v === 255 ? null : v / 200; };
  const gcolor = useMemo(() => new Map(data?.groups.map(g => [g.id, g.color]) || []), [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return data.deputies.map((d, i) => ({d, i})).filter(({d}) => (!group || d.group === group) && (!q || `${d.name} ${d.dept} ${d.group}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q)));
  }, [data, query, group]);

  // quiz: the latest decisive votes on whole texts
  const quizVotes = useMemo(() => data ? data.keyVotes.filter(k => /l'ensemble/i.test(k.title)).slice(0, QUIZ_SIZE) : [], [data]);
  const quizResult = useMemo(() => {
    if (!data) return null;
    const keys = quizVotes.map((k, qi) => [k, answers[qi]] as const).filter(([, a]) => a);
    if (keys.length < 3) return null;
    const scores = data.deputies.map((_, i) => {
      let n = 0, s = 0;
      for (const [k, a] of keys) { const b = k.ballots[i]; if (b !== '-') { n++; if (b === a) s++; } }
      // need most of the answered votes cast, and rank with a small prior so 2/2 never beats 9/10
      return {i, n, score: n >= Math.max(3, Math.ceil(keys.length * 0.6)) ? s / n : -1, rank: (s + 1) / (n + 2)};
    }).filter(x => x.score >= 0).sort((a, b) => b.rank - a.rank || b.n - a.n);
    const groups = data.groups.map(g => {
      let n = 0, s = 0;
      for (const [k, a] of keys) {
        const c: Record<string, number> = {p: 0, c: 0, a: 0};
        data.deputies.forEach((d, i) => { if (d.group === g.id && k.ballots[i] !== '-') c[k.ballots[i]]++; });
        const m = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
        if (m[1]) { n++; if (m[0] === a) s++; }
      }
      return {g, score: n ? s / n : 0};
    }).sort((a, b) => b.score - a.score);
    return {answered: keys.length, top: scores.slice(0, 8), groups};
  }, [data, answers, quizVotes]);
  useEffect(() => { if (view === 'quiz' && quizResult?.top[0]) setSelected(quizResult.top[0].i); }, [quizResult, view]);

  if (error) return <div className="omni-dashboard"><div role="alert" className="omni-alert">Parliament dataset unavailable ({error}). Run <code>npm run parliament:build</code>.</div></div>;
  if (!data) return <div className="omni-dashboard omni-parl"><div className="omni-map-loading">Loading the Assemblée…</div></div>;

  const sel = selected != null ? data.deputies[selected] : null;
  const cmp = compare != null ? data.deputies[compare] : null;
  const kv = data.keyVotes[vote];
  const sceneMode = view === 'hemicycle' ? 'hemicycle' : view === 'forecast' && fc ? 'forecast' : 'galaxy';
  const fa = fc?.live[fcSel];
  const pairAgree = sel && cmp ? agreement(selected!, compare!) : null;
  const diverge = sel && cmp ? data.keyVotes.filter(k => k.ballots[selected!] !== '-' && k.ballots[compare!] !== '-' && k.ballots[selected!] !== k.ballots[compare!]).slice(0, 8) : [];
  const groupMatrix = period >= 0 ? data.periods[period].groups : data.globalGroups;
  const counts = kv ? [...kv.ballots].reduce((m, b) => (m[b] = (m[b] || 0) + 1, m), {} as Record<string, number>) : {};
  const pickDeputy = (i: number | null) => {
    if (view === 'compare' && selected != null && i != null && i !== selected) { setCompare(i); return; }
    setSelected(i); if (i == null) setCompare(null);
  };

  const deputyCard = (d: typeof sel, i: number) => d && <div className="parl-card">
    <div className="parl-card-head">
      <img src={photo(d.id)} alt="" width={64} height={64} loading="lazy" />
      <div><h2>{d.name}</h2><p><span className="parl-chip" style={{background: gcolor.get(d.group)}}>{d.group}</span> {d.dept} · {d.circo}<sup>e</sup> circ.</p></div>
    </div>
    <dl className="parl-stats">
      <div><dt>Group loyalty</dt><dd>{pct(d.loyalty)}</dd></div>
      <div><dt>Participation</dt><dd>{pct(d.participation)}</dd></div>
      <div><dt>Votes cast</dt><dd>{d.votes.toLocaleString('fr-FR')}</dd></div>
    </dl>
    <div className="omni-section-label">CLOSEST VOTING TWINS</div>
    <ul className="parl-near">{d.near.map(([j, a]) => <li key={j}><button onClick={() => setSelected(j)}><span className="omni-topic-dot" style={{background: gcolor.get(data.deputies[j].group)}} />{data.deputies[j].name}<small>{data.deputies[j].group}</small><b>{pct(a)}</b></button></li>)}</ul>
    {d.bridge && data.deputies[d.bridge[0]].group !== d.group && <p className="parl-bridge">Closest ally outside {d.group}: <button onClick={() => setSelected(d.bridge![0])}>{data.deputies[d.bridge[0]].name} ({data.deputies[d.bridge[0]].group})</button> — {pct(d.bridge[1])} agreement</p>}
    <div className="parl-actions">
      <button onClick={() => { setView('compare'); setCompare(null); }}>⇄ Compare with…</button>
      <a href={anPage(d.id)} target="_blank" rel="noreferrer">Assemblée profile ↗</a>
    </div>
    {d.job && <p className="parl-muted">{d.job}{d.born ? ` · born ${d.born.slice(0, 4)}` : ''} · seat {d.seat || '—'} · #{i + 1}</p>}
  </div>;

  return <div className="omni-dashboard omni-parl">
    <div className="omni-heading">
      <div><p className="omni-eyebrow">05 / PARLIAMENT</p><h1>Who votes with whom.</h1>
        <p className="omni-subtitle">{data.deputies.length} deputies placed in 3D by how they actually vote, across {data.scrutins.toLocaleString('en-GB')} recorded divisions of the {data.legislature}th legislature. Close stars vote alike.</p></div>
      <div className="omni-heading-actions"><span className="omni-freshness">ASSEMBLÉE NATIONALE<small>Data through {data.range[1]}</small></span></div>
    </div>
    <div className="parl-views" role="tablist">{VIEWS.map(([id, label, mark]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}><span aria-hidden>{mark}</span>{label}</button>)}</div>
    {view === 'insights' ? <div className="ins-wrap"><Insights data={data} onPick={i => { setSelected(i); setView('galaxy'); }} /></div> :
    <div className="omni-workspace parl-workspace">
      <aside className="omni-sidebar">
        {view === 'forecast' && fc ? <ForecastList fc={fc} data={data} sel={fcSel} onSel={i => { setFcSel(i); setOverlay(null); }} sort={fcSort} setSort={setFcSort} />
        : view === 'hemicycle' ? <>
          <div className="omni-sidebar-top"><div className="omni-section-label">SOLEMN & FINAL VOTES <span>{data.keyVotes.length}</span></div></div>
          <div className="omni-record-list">{data.keyVotes.map((k, i) => <button key={k.n} className="parl-vote-row" aria-pressed={i === vote} onClick={() => setVote(i)}>
            <small>{k.date} · n°{k.n} · <b className={k.sort === 'adopté' ? 'ok' : 'ko'}>{k.sort}</b></small><span>{cap(k.title)}</span></button>)}</div>
        </> : view === 'quiz' ? <>
          <div className="omni-sidebar-top"><div className="omni-section-label">YOUR VOTE <span>{Object.keys(answers).length}/{quizVotes.length}</span></div>
            <p className="parl-muted">Vote on the latest final readings. We find the deputies and groups who voted like you.</p></div>
          <div className="omni-record-list">{quizVotes.map((k, qi) => <div key={k.n} className="parl-quiz">
            <small>{k.date} · <b className={k.sort === 'adopté' ? 'ok' : 'ko'}>{k.sort}</b></small><p>{cap(k.title)}</p>
            <div>{(['p', 'c', 'a'] as const).map(b => <button key={b} data-b={b} aria-pressed={answers[qi] === b} onClick={() => setAnswers(a => ({...a, [qi]: a[qi] === b ? '' : b}))}>{BALLOT_LABEL[b]}</button>)}</div>
          </div>)}</div>
        </> : <>
          <div className="omni-sidebar-top">
            <div className="omni-section-label">{view === 'compare' ? 'PICK TWO DEPUTIES' : 'DEPUTIES'} <span>{list.length}</span></div>
            <input className="omni-search" placeholder="Name, département, group…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search deputies" />
            <div className="parl-groups">{data.groups.map(g => <button key={g.id} aria-pressed={group === g.id} onClick={() => setGroup(group === g.id ? null : g.id)} title={g.name}><i style={{background: g.color}} />{g.id}<small>{g.size}</small></button>)}</div>
          </div>
          <div className="omni-record-list">{list.slice(0, 250).map(({d, i}) => <button key={d.id} className="parl-dep-row" aria-pressed={i === selected || i === compare} onClick={() => pickDeputy(i)}>
            <span className="omni-topic-dot" style={{background: gcolor.get(d.group)}} /><span>{d.name}<small>{d.group} · {d.dept}</small></span><b>{pct(d.loyalty)}</b></button>)}</div>
        </>}
      </aside>

      <section className="omni-map-area parl-stage">
        <Scene3D data={data} mode={sceneMode} period={view === 'galaxy' ? period : -1} selected={selected} compare={compare}
          ballots={view === 'hemicycle' ? kv?.ballots ?? null : null} probs={sceneMode === 'forecast' ? fa?.p ?? null : null} confidence={fa?.conf} highlightGroup={group} showLinks={links} autoRotate={rotate && selected == null}
          onPick={pickDeputy} onHover={(i, x, y) => setHover(i == null ? null : {i, x, y})} />
        {hover && <div className="parl-tip" style={{left: hover.x + 14, top: hover.y + 10}}>
          <b>{data.deputies[hover.i].name}</b><span style={{color: tc(gcolor.get(data.deputies[hover.i].group))}}>{data.deputies[hover.i].group}</span>
          {sceneMode === 'forecast' && fa ? <em>projected P(for) {fa.p[hover.i]}%</em> : view === 'hemicycle' && kv ? <em>{BALLOT_LABEL[kv.ballots[hover.i]]}</em> : selected != null && hover.i !== selected ? <em>{pct(agreement(selected, hover.i))} agreement with {data.deputies[selected].name}</em> : <em>loyalty {pct(data.deputies[hover.i].loyalty)}</em>}
        </div>}
        <div className="parl-overlay">
          {sceneMode === 'galaxy' && <><label><input type="checkbox" checked={links} onChange={e => setLinks(e.target.checked)} /> Twin links</label><span className="parl-legend-gold">— gold: cross-group allies</span></>}
          <label><input type="checkbox" checked={rotate} onChange={e => setRotate(e.target.checked)} /> Orbit</label>
          {view === 'hemicycle' && <span className="parl-ballot-legend">{(['p', 'c', 'a', '-'] as const).map(b => <span key={b} data-b={b}>{BALLOT_LABEL[b]} {counts[b] || 0}</span>)}</span>}
        </div>
        {sceneMode === 'forecast' && fa && <div className="fc-stage-hud">
          <div className="fc-hud-legend"><span>0%</span><i /><span>100% P(for)</span></div>
          <div className="fc-hud-count"><b>{fa.projectedFor}</b><small>deputies projected ≥ 50% for</small></div>
          <div className="fc-hud-actions"><button aria-pressed={overlay === 'track'} onClick={() => setOverlay(o => o === 'track' ? null : 'track')}>◎ Orcet track record</button><button aria-pressed={overlay === 'signals'} onClick={() => setOverlay(o => o === 'signals' ? null : 'signals')}>◌ Weak-signal radar</button></div>
        </div>}
        {view === 'forecast' && fc && overlay === 'track' && <TrackRecord fc={fc} data={data} onClose={() => setOverlay(null)} />}
        {view === 'forecast' && fc && overlay === 'signals' && <SignalsRadar fc={fc} onClose={() => setOverlay(null)} />}
        {view === 'galaxy' && <div className="omni-timeline parl-timeline">
          <button onClick={() => { if (period < 0) setPeriod(0); setPlaying(p => !p); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <div className="omni-timeline-title"><strong>{period < 0 ? 'Whole legislature' : data.periods[period].id.replace('-', ' · ')}</strong><small>{period < 0 ? `${data.range[0]} → ${data.range[1]}` : `${data.periods[period].scrutins} divisions this quarter`}</small></div>
          <input className="omni-timeline-slider" type="range" min={-1} max={data.periods.length - 1} value={period} onChange={e => { setPlaying(false); setPeriod(+e.target.value); }} aria-label="Quarter" />
        </div>}
      </section>

      <aside className="omni-detail parl-detail">
        {view === 'forecast' && fa && fc ? <ForecastDetail fc={fc} data={data} a={fa} selected={selected} agreement={agreement} onOpen={() => setView('galaxy')} onClear={() => setSelected(null)} />
        : view === 'hemicycle' && kv ? <div className="parl-card">
          <p className="omni-eyebrow">SCRUTIN N°{kv.n} · {kv.date} · {kv.type === 'SPS' ? 'SOLEMN' : 'ORDINARY'}</p>
          <h2>{cap(kv.title)}</h2>
          <p className={`parl-result ${kv.sort === 'adopté' ? 'ok' : 'ko'}`}>{kv.sort === 'adopté' ? 'Adopted' : 'Rejected'} — {kv.pour} for · {kv.contre} against · {kv.abst} abstained</p>
          <div className="omni-section-label">BY GROUP</div>
          <div className="parl-bars">{data.groups.map(g => {
            const c: Record<string, number> = {p: 0, c: 0, a: 0, '-': 0};
            data.deputies.forEach((d, i) => { if (d.group === g.id) c[kv.ballots[i]]++; });
            return <div key={g.id} className="parl-bar"><span style={{color: tc(g.color)}}>{g.id}</span><div>{(['p', 'c', 'a', '-'] as const).map(b => <i key={b} data-b={b} style={{flex: c[b]}} title={`${BALLOT_LABEL[b]}: ${c[b]}`} />)}</div></div>;
          })}</div>
          <a href={scrutinPage(kv.n)} target="_blank" rel="noreferrer">Official record ↗</a>
          {sel && <p className="parl-muted">{sel.name}: <b>{BALLOT_LABEL[kv.ballots[selected!]]}</b></p>}
        </div>
        : view === 'compare' ? <div className="parl-card">
          <p className="omni-eyebrow">VOTING COMPARATOR</p>
          {!sel ? <p className="parl-muted">Pick a first deputy in the list or the galaxy.</p> : !cmp ? <><h2>{sel.name}</h2><p className="parl-muted">Now pick a second deputy. The dashed gold line will join them in space.</p></> : <>
            <div className="parl-vs">{[sel, cmp].map((d, k) => <button key={d.id} onClick={() => k ? setCompare(null) : (setSelected(compare), setCompare(null))}><img src={photo(d.id)} alt="" width={56} height={56} /><b>{d.name}</b><small style={{color: tc(gcolor.get(d.group))}}>{d.group}</small></button>)}</div>
            <div className="parl-big">{pct(pairAgree)}<small>identical positions when both voted</small></div>
            <div className="omni-section-label">WHERE THEY SPLIT (FINAL & SOLEMN VOTES)</div>
            {diverge.length ? <ul className="parl-split">{diverge.map(k => <li key={k.n}><a href={scrutinPage(k.n)} target="_blank" rel="noreferrer">{cap(k.title)}</a><span><b data-b={k.ballots[selected!]}>{BALLOT_LABEL[k.ballots[selected!]]}</b> vs <b data-b={k.ballots[compare!]}>{BALLOT_LABEL[k.ballots[compare!]]}</b></span></li>)}</ul> : <p className="parl-muted">No disagreement on key votes they both cast.</p>}
          </>}
        </div>
        : view === 'quiz' ? <div className="parl-card">
          <p className="omni-eyebrow">YOUR POLITICAL TWINS</p>
          {!quizResult ? <p className="parl-muted">Answer at least 3 votes. Results update live and your best match lights up in the galaxy.</p> : <>
            <div className="omni-section-label">GROUPS</div>
            <div className="parl-bars">{quizResult.groups.map(({g, score}) => <div key={g.id} className="parl-bar"><span style={{color: tc(g.color)}}>{g.id}</span><div><i style={{flex: score, background: g.color}} /><i style={{flex: 1 - score}} data-b="-" /></div><b>{pct(score)}</b></div>)}</div>
            <div className="omni-section-label">DEPUTIES</div>
            <ul className="parl-near">{quizResult.top.map(({i, score, n}) => <li key={i}><button onClick={() => setSelected(i)}><span className="omni-topic-dot" style={{background: gcolor.get(data.deputies[i].group)}} />{data.deputies[i].name}<small>{data.deputies[i].group} · {n} votes</small><b>{pct(score)}</b></button></li>)}</ul>
          </>}
        </div>
        : sel ? deputyCard(sel, selected!)
        : <div className="parl-card">
          <p className="omni-eyebrow">GROUP AFFINITIES · {period < 0 ? 'LEGISLATURE' : data.periods[period].id}</p>
          <p className="parl-muted">Share of divisions where both groups' majority positions matched.</p>
          <GroupMatrix data={data} rows={groupMatrix} />
          <p className="parl-muted">Click a star, or press ▶ to watch coalitions move quarter by quarter.</p>
        </div>}
        <p className="parl-source">Source: <a href={data.source.url} target="_blank" rel="noreferrer">{data.source.name}</a> — {data.source.license}. {data.method}</p>
      </aside>
    </div>}
  </div>;
}

function GroupMatrix({data, rows}: {data: Galaxy; rows: [string, string, number, number][]}) {
  const ids = data.groups.map(g => g.id);
  const m = new Map(rows.flatMap(([a, b, v]) => [[`${a}|${b}`, v], [`${b}|${a}`, v]]));
  return <div className="parl-matrix" style={{gridTemplateColumns: `44px repeat(${ids.length}, 1fr)`}}>
    <span />{ids.map(id => <span key={id} className="parl-mx-h" style={{color: tc(data.groups.find(g => g.id === id)!.color)}}>{id}</span>)}
    {ids.map(a => <Fragment key={a}>
      <span className="parl-mx-r" style={{color: tc(data.groups.find(g => g.id === a)!.color)}}>{a}</span>
      {ids.map(b => { const v = a === b ? 1 : m.get(`${a}|${b}`); return <span key={a + b} className="parl-mx-c" title={`${a} × ${b}: ${v == null ? 'n/a' : pct(v)}`} style={{background: v == null ? 'transparent' : `hsla(${v * 130 - 10}, 65%, 45%, ${0.25 + v * 0.75})`}}>{v == null || a === b ? '' : Math.round(v * 100)}</span>; })}
    </Fragment>)}
  </div>;
}
