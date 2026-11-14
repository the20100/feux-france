'use client';
import * as d3 from 'd3';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Forecast, Galaxy, LivePrediction} from './types';
import {photo, scrutinPage} from './types';

const tc = (c?: string) => c ? `color-mix(in srgb, ${c} 55%, #ffffff)` : undefined;
const pColor = (p: number) => d3.interpolateRgbBasis(['#ef5b5b', '#c9b47a', '#4fe39a'])(p / 100);
const GROUP_ALIAS: Record<string, string> = {DEM: 'Dem', ECOS: 'EcoS', UDDPLR: 'UDR'};
export const groupLabel = (g: string) => g === 'GOV' ? 'Government' : g;

/* ---------------- sidebar: live amendments ---------------- */
export function ForecastList({fc, data, sel, onSel, sort, setSort}: {fc: Forecast; data: Galaxy; sel: number; onSel: (i: number) => void; sort: string; setSort: (s: string) => void}) {
  const gcolor = new Map(data.groups.map(g => [g.id, g.color]));
  const order = useMemo(() => fc.live.map((a, i) => ({a, i})).sort((x, y) => sort === 'tension' ? Math.abs(x.a.mean - 0.5) - Math.abs(y.a.mean - 0.5) : sort === 'conf' ? y.a.conf - x.a.conf : +y.a.n - +x.a.n), [fc, sort]);
  return <>
    <div className="omni-sidebar-top">
      <div className="omni-section-label">ORCET · LIVE FORECASTS <span>{fc.live.length}</span></div>
      <p className="parl-muted" style={{margin: '8px 0'}}>{fc.text.title}. Amendments not yet voted, predicted {new Date(fc.fetchedAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'long'})}.</p>
      <div className="parl-seg" role="group" aria-label="Sort">{[['tension', 'Most uncertain'], ['conf', 'Most confident'], ['n', 'Latest']].map(([k, l]) => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}</div>
    </div>
    <div className="omni-record-list">{order.map(({a, i}) => <button key={a.uid} className="fc-row" aria-pressed={i === sel} onClick={() => onSel(i)}>
      <MiniGauge v={a.mean} conf={a.conf} />
      <span><small>N°{a.n} · {a.article} · <b style={{color: tc(gcolor.get(a.group) || '#b9b4ff')}}>{groupLabel(a.group)}</b></small>{a.summary}</span>
    </button>)}</div>
  </>;
}

function MiniGauge({v, conf}: {v: number; conf: number}) {
  const r = 15, c = 2 * Math.PI * r;
  return <svg className="fc-mini" viewBox="0 0 40 40" aria-label={`${Math.round(v * 100)}%`}>
    <circle cx="20" cy="20" r={r} fill="none" stroke="#24302b" strokeWidth="4" />
    <circle cx="20" cy="20" r={r} fill="none" stroke={pColor(v * 100)} strokeWidth="4" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 20 20)" strokeLinecap="round" />
    <circle cx="20" cy="20" r={r + 4.5} fill="none" stroke="#b9b4ff" strokeOpacity={0.15 + conf * 0.6} strokeWidth="1" strokeDasharray={`${2 * Math.PI * (r + 4.5) * conf} 999`} transform="rotate(-90 20 20)" />
    <text x="20" y="24" textAnchor="middle">{Math.round(v * 100)}</text>
  </svg>;
}

/* ---------------- detail: big gauge + simulation + group lean ---------------- */
export function ForecastDetail({fc, data, a, selected, agreement, onOpen, onClear}: {fc: Forecast; data: Galaxy; a: LivePrediction; selected?: number | null; agreement?: (i: number, j: number) => number | null; onOpen?: (i: number) => void; onClear?: () => void}) {
  const gcolor = new Map(data.groups.map(g => [g.id, g.color]));
  const author = a.authorIdx != null ? data.deputies[a.authorIdx] : null;
  const d = selected != null ? data.deputies[selected] : null;
  const withAuthor = d && a.authorIdx != null && agreement ? agreement(selected!, a.authorIdx) : null;
  return <div className="parl-card fc-detail" key={a.uid}>
    {d && <div className="fc-dep" key={d.id}>
      <button className="fc-dep-x" onClick={onClear} aria-label="Clear selection">×</button>
      <img src={photo(d.id)} alt="" width={52} height={52} />
      <div className="fc-dep-body">
        <b>{d.name}</b><small style={{color: tc(gcolor.get(d.group))}}>{d.group} · {d.dept}</small>
        <div className="fc-dep-p"><span style={{color: pColor(a.p[selected!])}}>{a.p[selected!]}%</span><em>projected P(for) on n°{a.n}</em></div>
        <div className="fc-dep-bar"><i style={{width: `${a.p[selected!]}%`, background: pColor(a.p[selected!])}} /></div>
        <p>{withAuthor != null ? <>Votes like the author {Math.round(withAuthor * 100)}% of the time · </> : null}group loyalty {d.loyalty != null ? `${Math.round(d.loyalty * 100)}%` : '—'} · participation {Math.round(d.participation * 100)}%</p>
        {onOpen && <button className="fc-dep-open" onClick={() => onOpen(selected!)}>Open full profile ✦</button>}
      </div>
    </div>}
    <p className="omni-eyebrow">AMENDMENT N°{a.n} · {a.article} · {fc.text.short}</p>
    <div className="fc-author">{author ? <img src={photo(author.id)} alt="" width={42} height={42} /> : <span className="fc-gov">RF</span>}<div><b>{a.signers}</b><small style={{color: tc(gcolor.get(a.group) || '#b9b4ff')}}>{groupLabel(a.group)}</small></div></div>
    <p className="fc-summary">{a.summary}</p>
    <BigGauge v={a.mean} conf={a.conf} />
    <p className="parl-muted fc-def">Average of deputies' individual probabilities of voting <b>for</b>, according to Orcet. Not a probability of adoption.</p>
    <MonteCarlo a={a} data={data} />
    <div className="omni-section-label">PROJECTED LEAN BY GROUP <span>Omni projection</span></div>
    <div className="fc-lean">{data.groups.map((g, k) => { const v = a.lean[g.id] ?? 50; return <div key={g.id} className="fc-lean-row">
      <span style={{color: tc(g.color)}}>{g.id}</span>
      <div className="fc-lean-track"><i className="fc-lean-mid" /><i className="fc-lean-bar" style={{left: v < 50 ? `${v}%` : '50%', width: `${Math.abs(v - 50)}%`, background: pColor(v), transitionDelay: `${k * 40}ms`}} /></div>
      <b>{v}</b></div>; })}</div>
    <p className="parl-source">{fc.method} Source: <a href={fc.source.url} target="_blank" rel="noreferrer">{fc.source.name}</a> — {fc.source.license}.</p>
  </div>;
}

function BigGauge({v, conf}: {v: number; conf: number}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now(), from = 0;
    const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1100); const e = 1 - Math.pow(1 - k, 3); setShown(from + (v - from) * e); if (k < 1) raf = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(raf);
  }, [v]);
  const R = 92, arc = d3.arc<number>().innerRadius(R - 14).outerRadius(R).startAngle(-Math.PI * 0.75).cornerRadius(7);
  const end = -Math.PI * 0.75 + Math.PI * 1.5 * shown;
  const ticks = d3.range(0, 101, 10);
  return <svg className="fc-gauge" viewBox="-110 -110 220 180" role="img" aria-label={`Mean probability for ${Math.round(v * 100)} percent, confidence ${Math.round(conf * 100)} percent`}>
    <defs>
      <linearGradient id="fcg" x1="0" x2="1"><stop offset="0" stopColor="#ef5b5b" /><stop offset=".5" stopColor="#c9b47a" /><stop offset="1" stopColor="#4fe39a" /></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
    <path d={arc.endAngle(Math.PI * 0.75)(0) || ''} fill="#1c2622" />
    <path d={arc.endAngle(end)(0) || ''} fill="url(#fcg)" filter="url(#glow)" />
    {ticks.map(t => { const a = -Math.PI * 0.75 + Math.PI * 1.5 * t / 100 - Math.PI / 2; return <line key={t} x1={Math.cos(a) * (R + 4)} y1={Math.sin(a) * (R + 4)} x2={Math.cos(a) * (R + (t % 50 ? 8 : 13))} y2={Math.sin(a) * (R + (t % 50 ? 8 : 13))} stroke="#5d6d64" />; })}
    <line x1="0" y1={-(R + 16)} x2="0" y2={-(R - 18)} stroke="#e6ebe1" strokeDasharray="2 3" opacity=".5" />
    <path d={d3.arc<number>().innerRadius(R - 26).outerRadius(R - 22).startAngle(-Math.PI * 0.75).endAngle(-Math.PI * 0.75 + Math.PI * 1.5 * conf).cornerRadius(2)(0) || ''} fill="#b9b4ff" opacity=".85" />
    <text className="fc-gauge-v" y="8" textAnchor="middle">{Math.round(shown * 100)}<tspan dy="-22" fontSize="16">%</tspan></text>
    <text className="fc-gauge-l" y="30" textAnchor="middle">MEAN P(FOR)</text>
    <text className="fc-gauge-c" y="52" textAnchor="middle">confidence {Math.round(conf * 100)}%</text>
  </svg>;
}

/** Monte Carlo over Omni's seat-level projection: turnout from each deputy's observed participation. */
function MonteCarlo({a, data}: {a: LivePrediction; data: Galaxy}) {
  const ref = useRef<SVGSVGElement>(null);
  const [stats, setStats] = useState({n: 0, wins: 0, mFor: 0, mAg: 0});
  const [run, setRun] = useState(0);
  useEffect(() => {
    const svg = d3.select(ref.current!); svg.selectAll('*').remove();
    const W = 300, H = 110, BINS = 41, lo = -200, hi = 200;
    const x = d3.scaleLinear([lo, hi], [0, W]);
    const counts = new Array(BINS).fill(0);
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', H).attr('stroke', '#e6ebe1').attr('stroke-dasharray', '2 3').attr('opacity', .5);
    svg.append('text').attr('x', x(0) - 4).attr('y', 10).attr('text-anchor', 'end').attr('class', 'fc-mc-l').text('rejected ←');
    svg.append('text').attr('x', x(0) + 4).attr('y', 10).attr('class', 'fc-mc-l').text('→ adopted');
    const bars = svg.append('g').selectAll('rect').data(counts).join('rect')
      .attr('x', (_, i) => x(lo + (i * (hi - lo)) / BINS) + 0.5).attr('width', W / BINS - 1).attr('y', H).attr('height', 0)
      .attr('fill', (_, i) => lo + (i + 0.5) * (hi - lo) / BINS > 0 ? '#4fe39a' : '#ef5b5b').attr('rx', 1);
    const dots = svg.append('g');
    const total = 600; let done = 0, wins = 0, sf = 0, sa = 0, raf = 0;
    const p = a.p, part = data.deputies.map(d => Math.min(0.95, Math.max(0.03, d.participation)));
    const step = () => {
      for (let k = 0; k < 12 && done < total; k++, done++) {
        let f = 0, g = 0;
        for (let i = 0; i < p.length; i++) if (Math.random() < part[i]) { if (Math.random() * 100 < p[i]) f++; else g++; }
        const m = f - g; if (m > 0) wins++; sf += f; sa += g;
        const b = Math.max(0, Math.min(BINS - 1, Math.floor((m - lo) / (hi - lo) * BINS))); counts[b]++;
        if (k === 0) dots.append('circle').attr('cx', x(Math.max(lo, Math.min(hi, m)))).attr('cy', -4).attr('r', 2.2).attr('fill', m > 0 ? '#4fe39a' : '#ef5b5b')
          .transition().duration(500).ease(d3.easeQuadIn).attr('cy', H - 2).style('opacity', 0).remove();
      }
      const max = d3.max(counts) || 1;
      bars.attr('y', (_: number, i: number) => H - (counts[i] / max) * (H - 16)).attr('height', (_: number, i: number) => (counts[i] / max) * (H - 16));
      setStats({n: done, wins, mFor: sf / done, mAg: sa / done});
      if (done < total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [a, data, run]);
  const share = stats.n ? stats.wins / stats.n : 0;
  return <div className="fc-mc">
    <div className="omni-section-label">CHAMBER SIMULATION <span><button className="fc-replay" onClick={() => setRun(r => r + 1)}>↻ re-run</button></span></div>
    <svg ref={ref} viewBox="0 -8 300 120" className="fc-mc-svg" />
    <div className="fc-mc-stats">
      <div><b style={{color: pColor(share * 100)}}>{Math.round(share * 100)}%</b><small>of {stats.n} simulated sittings adopt it</small></div>
      <div><b>{Math.round(stats.mFor)}–{Math.round(stats.mAg)}</b><small>typical for–against</small></div>
    </div>
    <p className="parl-muted">Each run draws who shows up (from each deputy's real participation) and how they vote (from the projection). It is a simulation of the projection, not a forecast by Orcet.</p>
  </div>;
}

/* ---------------- overlay: track record ---------------- */
export function TrackRecord({fc, data, onClose}: {fc: Forecast; data: Galaxy; onClose: () => void}) {
  const gcolor = new Map(data.groups.map(g => [g.id, g.color]));
  const groups = data.groups.map(g => g.id);
  const [open, setOpen] = useState(0);
  const outcome = fc.track.filter(t => t.hit).length;
  let gTot = 0, gOk = 0;
  for (const t of fc.track) for (const [g0, [pp]] of Object.entries(t.groups)) { const g = GROUP_ALIAS[g0] || g0; const act = t.actualGroups?.[g]; if (!act || pp === 'divise' || act === 'divisé') continue; gTot++; if (act === pp) gOk++; }
  const t = fc.track[open];
  return <div className="fc-overlay">
    <button className="fc-close" onClick={onClose} aria-label="Close">×</button>
    <p className="omni-eyebrow">ORCET VS REALITY</p>
    <h2>Right on outcomes. Shaky on who.</h2>
    <p className="parl-muted">{fc.trackNote}</p>
    <div className="fc-scores">
      <Score v={outcome / fc.track.length} label={`${outcome}/${fc.track.length} outcomes called (mean above/below 50%)`} />
      <Score v={gOk / gTot} label={`${gOk}/${gTot} group positions matched`} />
    </div>
    <div className="fc-track-grid">{fc.track.map((x, i) => {
      const actual = x.pour / Math.max(1, x.pour + x.contre + x.abst);
      return <button key={x.scrutin} className="fc-track" aria-pressed={i === open} onClick={() => setOpen(i)} style={{animationDelay: `${i * 60}ms`}}>
        <span className={x.hit ? 'ok' : 'ko'}>{x.hit ? '✓' : '✗'}</span><b>{x.label}</b>
        <div className="fc-track-bar"><i style={{width: `${actual * 100}%`}} /><em style={{left: `${x.mean}%`}} title="Orcet mean" /></div>
        <small>{x.pour}–{x.contre}{x.abst ? ` (${x.abst} abst.)` : ''} · Orcet {Math.round(x.mean)}%</small>
      </button>;
    })}</div>
    {t && <div className="fc-track-detail">
      <div className="omni-section-label">{t.label.toUpperCase()} · GROUPS, PREDICTED → ACTUAL <a href={scrutinPage(t.scrutin)} target="_blank" rel="noreferrer">scrutin n°{t.scrutin} ↗</a></div>
      <div className="fc-gp">{groups.map(g => { const pr = Object.entries(t.groups).find(([k]) => (GROUP_ALIAS[k] || k) === g)?.[1]; const act = t.actualGroups?.[g]; const ok = pr && act && pr[0] === act; return <div key={g} className={`fc-gp-cell ${pr && act && pr[0] !== 'divise' && act !== 'divisé' ? ok ? 'ok' : 'ko' : ''}`}>
        <span style={{color: tc(gcolor.get(g))}}>{g}</span><small>{pr ? `${pr[0]} ${pr[1]}%` : '—'}</small><b>{act || '—'}</b></div>; })}</div>
      <div className="omni-section-label">DEPUTIES ORCET FLAGGED AS LIKELY TO BREAK RANKS</div>
      <div className="fc-watch">{t.watch.map(w => <div key={w.id}><img src={photo(w.id)} alt="" width={30} height={30} /><span>{w.name}<small>{w.group} · P(for) {Math.round(w.p)}% · gap {Math.round(w.gap)} pts</small></span><b data-b={w.ballot}>{w.ballot === 'p' ? 'For' : w.ballot === 'c' ? 'Against' : w.ballot === 'a' ? 'Abstain' : 'Absent'}</b></div>)}</div>
    </div>}
  </div>;
}
function Score({v, label}: {v: number; label: string}) {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setTimeout(() => setS(v), 80); return () => clearTimeout(t); }, [v]);
  return <div className="fc-score"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="#24302b" strokeWidth="10" /><circle cx="60" cy="60" r="50" fill="none" stroke={pColor(v * 100)} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${314 * s} 400`} transform="rotate(-90 60 60)" style={{transition: 'stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1)'}} /><text x="60" y="68" textAnchor="middle">{Math.round(v * 100)}%</text></svg><small>{label}</small></div>;
}

/* ---------------- overlay: weak-signal radar (force bubbles) ---------------- */
export function SignalsRadar({fc, onClose}: {fc: Forecast; onClose: () => void}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const W = 760, H = 460;
    const svg = d3.select(ref.current!); svg.selectAll('*').remove();
    type Node = d3.SimulationNodeDatum & {i: number; r: number; cat: string};
    const nodes: Node[] = fc.signals.map((s, i) => ({i, r: 13 + Math.sqrt(Math.max(1, s.cur / Math.max(0.3, s.base))) * 4.2 * (s.s / 100), cat: s.cat, x: W / 2 + (Math.random() - .5) * 50, y: H / 2 + (Math.random() - .5) * 50}));
    nodes.forEach(n => (n.r = Math.min(n.r, 58)));
    const color = (s: (typeof fc.signals)[number]) => s.cat === 'legislatif' ? (s.trend === 'critique' ? '#ff6b6b' : '#ffa36b') : (s.trend === 'critique' ? '#b9b4ff' : '#7fd3ff');
    // concentric radar rings
    const g0 = svg.append('g').attr('opacity', .5);
    [70, 140, 210].forEach((r, k) => g0.append('circle').attr('cx', W / 2).attr('cy', H / 2).attr('r', r).attr('fill', 'none').attr('stroke', '#2c3931').attr('stroke-dasharray', k === 2 ? '2 4' : null));
    const sweep = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    sweep.append('path').attr('d', d3.arc()({innerRadius: 0, outerRadius: 240, startAngle: 0, endAngle: Math.PI / 5}) || '').attr('fill', 'url(#sweepg)').attr('opacity', .35);
    const defs = svg.append('defs'); const rg = defs.append('radialGradient').attr('id', 'sweepg');
    rg.append('stop').attr('offset', 0).attr('stop-color', '#b9b4ff').attr('stop-opacity', .0); rg.append('stop').attr('offset', 1).attr('stop-color', '#b9b4ff').attr('stop-opacity', .5);
    let ang = 0; const timer = d3.timer(() => { ang = (ang + 0.6) % 360; sweep.attr('transform', `translate(${W / 2},${H / 2}) rotate(${ang})`); });
    const node = svg.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHover(d.i)).on('mouseleave', () => setHover(null));
    node.append('circle').attr('r', 0).attr('fill', d => color(fc.signals[d.i])).attr('fill-opacity', .16).attr('stroke', d => color(fc.signals[d.i])).attr('stroke-width', 1.4)
      .transition().delay(d => d.i * 45).duration(900).ease(d3.easeElasticOut.amplitude(1).period(.5)).attr('r', d => d.r);
    node.filter(d => fc.signals[d.i].trend === 'critique').append('circle').attr('r', d => d.r).attr('fill', 'none').attr('stroke', d => color(fc.signals[d.i])).attr('class', 'fc-ping');
    node.append('text').attr('text-anchor', 'middle').attr('dy', '.35em').attr('class', 'fc-sig-t')
      .text(d => { const t = fc.signals[d.i].t.replace(/^Texte n° 3188(, | de la commission — )/, '3188 · ').replace(/ : .*/, ''); return d.r > 34 ? (t.length > d.r / 3.3 ? t.slice(0, Math.floor(d.r / 3.3)) + '…' : t) : ''; })
      .style('font-size', d => `${Math.max(9, Math.min(13, d.r / 4))}px`).attr('opacity', 0).transition().delay(d => 400 + d.i * 45).attr('opacity', 1);
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX(W / 2).strength(0.05)).force('y', d3.forceY(H / 2).strength(0.08))
      .force('collide', d3.forceCollide<Node>(d => d.r + 3).iterations(3)).force('box', () => { for (const n of nodes) { n.x = Math.max(n.r, Math.min(W - n.r, n.x!)); n.y = Math.max(n.r, Math.min(H - n.r, n.y!)); } }).force('cat', d3.forceX<Node>(d => d.cat === 'legislatif' ? W * 0.32 : W * 0.66).strength(0.06))
      .on('tick', () => node.attr('transform', d => `translate(${d.x},${d.y})`));
    return () => { sim.stop(); timer.stop(); };
  }, [fc]);
  const s = hover != null ? fc.signals[hover] : null;
  return <div className="fc-overlay fc-radar">
    <button className="fc-close" onClick={onClose} aria-label="Close">×</button>
    <p className="omni-eyebrow">WEAK SIGNALS · HÉMICYCLE</p>
    <h2>What is heating up.</h2>
    <p className="parl-muted">Bubble size = current mentions vs their usual level, weighted by Hémicycle's intensity score (0–100, not a probability). Left: legislative activity. Right: media themes. Pulsing = critical.</p>
    <svg ref={ref} viewBox="0 0 760 460" className="fc-radar-svg" />
    {s && <div className="fc-sig-card"><b>{s.t}</b><small>score {s.s} · {s.trend} · {s.cur} now vs {s.base} usual</small>{s.ev && <Spark ev={s.ev} />}</div>}
    <div className="omni-section-label">ON THE AGENDA · WEEK OF 16 NOVEMBER</div>
    <div className="fc-ticker"><div>{[...fc.agenda, ...fc.agenda].map((t, i) => <span key={i}>✦ {t}</span>)}</div></div>
  </div>;
}
function Spark({ev}: {ev: number[]}) {
  const W = 200, H = 40, x = d3.scaleLinear([0, ev.length - 1], [2, W - 2]), y = d3.scaleLinear([0, d3.max(ev) || 1], [H - 2, 4]);
  const line = d3.line<number>((_, i) => x(i), d => y(d)).curve(d3.curveMonotoneX);
  const area = d3.area<number>((_, i) => x(i), H, d => y(d)).curve(d3.curveMonotoneX);
  return <svg viewBox={`0 0 ${W} ${H}`} className="fc-spark"><path d={area(ev) || ''} fill="#b9b4ff" opacity=".15" /><path d={line(ev) || ''} fill="none" stroke="#b9b4ff" strokeWidth="1.6" className="fc-draw" /></svg>;
}
