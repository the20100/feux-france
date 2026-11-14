'use client';
import * as d3 from 'd3';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Galaxy, LivePrediction} from './types';
import {anPage, photo} from './types';
import {briefing, plan, type Goal, type Plan, type Target} from './whip';

const tc = (c?: string) => c ? `color-mix(in srgb, ${c} 55%, #ffffff)` : undefined;
const pColor = (p: number) => d3.interpolateRgbBasis(['#ef5b5b', '#c9b47a', '#4fe39a'])(p / 100);

export function useStrategy(data: Galaxy | null, a: LivePrediction | undefined, goal: Goal, agreement: (i: number, j: number) => number | null, on: boolean) {
  return useMemo(() => on && data && a ? plan(data, a.p, goal, agreement) : null, [data, a, goal, agreement, on]);
}

export default function StrategyPanel({data, a, goal, setGoal, pl, onPick, selected}: {
  data: Galaxy; a: LivePrediction; goal: Goal; setGoal: (g: Goal) => void; pl: Plan; onPick: (i: number) => void; selected: number | null;
}) {
  const [tab, setTab] = useState<'persuade' | 'mobilise'>('persuade');
  const gcolor = new Map(data.groups.map(g => [g.id, g.color]));
  const reached = pl.margin > 0;
  const k50 = pl.curve.find(c => c.win >= 0.5)?.k;
  return <div className="st">
    <div className="st-goal" role="group" aria-label="Goal">
      <button aria-pressed={goal === 'pass'} data-g="pass" onClick={() => setGoal('pass')}>▲ Get it adopted</button>
      <button aria-pressed={goal === 'block'} data-g="block" onClick={() => setGoal('block')}>▼ Get it rejected</button>
    </div>

    <div className={`st-head ${reached ? 'ok' : 'ko'}`}>
      <div className="st-big"><b>{reached ? `+${Math.round(pl.margin)}` : pl.votesShort}</b><small>{reached ? 'vote cushion in expectation' : 'votes short in expectation'}</small></div>
      <div className="st-tally">
        <TallyBar f={pl.expFor} a={pl.expAgainst} />
        <small>Expected {Math.round(pl.expFor)} for · {Math.round(pl.expAgainst)} against · ~{Math.round(pl.expVoters)} present</small>
      </div>
    </div>
    <p className="st-line">Goal reached in <b style={{color: pColor(pl.winNow * 100)}}>{Math.round(pl.winNow * 100)}%</b> of simulated sittings today.{' '}
      {reached ? <>Priority: keep allies in the room (see <i>Mobilise</i>).</> : pl.flipsNeeded > 0 ? <>Winning over or bringing in the top <b>{pl.flipsNeeded}</b> deputies closes the gap in expectation{k50 != null ? <>; <b>{k50}</b> gets your odds past 50%</> : null}.</> : <>Even 40 actions don't close the gap: this vote is out of reach without moving a whole group.</>}</p>

    <Curve pl={pl} />

    {pl.groups.length > 0 && <div className="st-groups"><div className="omni-section-label">WHERE THE MOVABLE VOTES ARE</div>
      <div>{pl.groups.slice(0, 6).map(g => <span key={g.id} style={{borderColor: gcolor.get(g.id), color: tc(gcolor.get(g.id))}}>{g.id} <b>{g.n}</b></span>)}</div></div>}

    <div className="parl-seg st-tabs">{([['persuade', `Persuade · ${pl.persuade.length}`], ['mobilise', `Mobilise · ${pl.mobilise.length}`]] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    <p className="parl-muted st-hint">{tab === 'persuade' ? 'Leaning the other way but movable, ranked by expected votes gained × how movable they look. Messenger = the ally who votes most like them.' : 'Already on your side but often absent. Getting them into the chamber is often cheaper than converting anyone.'}</p>
    <ol className="st-list">{(tab === 'persuade' ? pl.persuade : pl.mobilise).slice(0, 15).map((t, k) => <TargetRow key={t.i} t={t} k={k} data={data} gcolor={gcolor} onPick={onPick} active={selected === t.i} />)}</ol>

    <Chat data={data} a={a} pl={pl} />
    <p className="parl-source">Estimates built on Omni's projection of Orcet's mean and on real participation; "convinced" = P(for) moved to {goal === 'pass' ? 85 : 15}%. Contact deputies through their official Assemblée page. Interest representatives must be registered with the HATVP.</p>
  </div>;
}

function TallyBar({f, a}: {f: number; a: number}) {
  const t = f + a || 1;
  return <div className="st-bar"><i data-b="p" style={{width: `${f / t * 100}%`}} /><i data-b="c" style={{width: `${a / t * 100}%`}} /><em /></div>;
}

function TargetRow({t, k, data, gcolor, onPick, active}: {t: Target; k: number; data: Galaxy; gcolor: Map<string, string>; onPick: (i: number) => void; active: boolean}) {
  const d = data.deputies[t.i], m = t.messenger ? data.deputies[t.messenger.i] : null;
  return <li className={`st-t${active ? ' on' : ''}`} style={{animationDelay: `${k * 35}ms`}}>
    <button className="st-t-main" onClick={() => onPick(t.i)}>
      <span className="st-rank">{k + 1}</span>
      <img src={photo(d.id)} alt="" width={34} height={34} loading="lazy" />
      <span className="st-t-name">{d.name}<small style={{color: tc(gcolor.get(d.group))}}>{d.group} · {d.dept}</small></span>
      <span className="st-t-p" style={{color: pColor(t.p)}}>{t.p}%</span>
    </button>
    <div className="st-t-meta">
      {t.why.map(w => <span key={w}>{w}</span>)}
      <span>+{t.raw.toFixed(2)} exp. votes</span>
    </div>
    <div className="st-t-act">
      {m && <button onClick={() => onPick(t.messenger!.i)} title="Ally who votes most like this deputy">via {m.name} <b>{Math.round(t.messenger!.agree * 100)}%</b></button>}
      <a href={anPage(d.id)} target="_blank" rel="noreferrer">Contact ↗</a>
    </div>
  </li>;
}

function Curve({pl}: {pl: Plan}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const W = 300, H = 120, m = {l: 26, r: 8, t: 8, b: 18};
    const svg = d3.select(ref.current!); svg.selectAll('*').remove();
    const x = d3.scaleLinear([0, pl.curve.length - 1], [m.l, W - m.r]), y = d3.scaleLinear([0, 1], [H - m.b, m.t]);
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0)).call(g => g.select('.domain').remove()).selectAll('text').attr('fill', '#a5b2a7').attr('font-size', 8);
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.0%')).tickSize(-(W - m.l - m.r))).call(g => g.select('.domain').remove()).call(g => g.selectAll('line').attr('stroke', '#1f2a25')).selectAll('text').attr('fill', '#a5b2a7').attr('font-size', 8);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(.5)).attr('y2', y(.5)).attr('stroke', '#e6ebe1').attr('stroke-dasharray', '2 3').attr('opacity', .5);
    const defs = svg.append('defs'), g = defs.append('linearGradient').attr('id', 'stg').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    g.append('stop').attr('offset', 0).attr('stop-color', '#b9b4ff').attr('stop-opacity', .45); g.append('stop').attr('offset', 1).attr('stop-color', '#b9b4ff').attr('stop-opacity', 0);
    const area = d3.area<{k: number; win: number}>(c => x(c.k), H - m.b, c => y(c.win)).curve(d3.curveMonotoneX);
    const line = d3.line<{k: number; win: number}>(c => x(c.k), c => y(c.win)).curve(d3.curveMonotoneX);
    svg.append('path').datum(pl.curve).attr('d', area).attr('fill', 'url(#stg)').attr('opacity', 0).transition().duration(900).attr('opacity', 1);
    const p = svg.append('path').datum(pl.curve).attr('d', line).attr('fill', 'none').attr('stroke', '#b9b4ff').attr('stroke-width', 2);
    const L = (p.node() as SVGPathElement).getTotalLength();
    p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().duration(1100).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);
    const k50 = pl.curve.find(c => c.win >= .5);
    if (k50) svg.append('circle').attr('cx', x(k50.k)).attr('cy', y(k50.win)).attr('r', 0).attr('fill', '#4fe39a').transition().delay(1000).attr('r', 4);
    svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end').attr('fill', '#a5b2a7').attr('font-size', 8).text('deputies acted on →');
  }, [pl]);
  return <div className="st-curve"><div className="omni-section-label">CHANCE OF SUCCESS VS DEPUTIES WON OVER OR BROUGHT IN</div><svg ref={ref} viewBox="0 0 300 120" /></div>;
}

const SUGGESTIONS = ['Who should I meet first, and why?', 'Draft a 3-step plan for this week.', 'Which group is the key to this vote?', 'What arguments might move the swing deputies?'];

function Chat({data, a, pl}: {data: Galaxy; a: LivePrediction; pl: Plan}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<{role: 'user' | 'assistant'; content: string}[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch('/api/parliament/strategy').then(r => r.json()).then(j => setEnabled(!!j.enabled)).catch(() => setEnabled(false)); }, []);
  useEffect(() => { setMsgs([]); setErr(''); }, [a.uid, pl.goal]);
  useEffect(() => { box.current?.scrollTo({top: box.current.scrollHeight, behavior: 'smooth'}); }, [msgs, busy]);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setErr(''); setBusy(true); setQ('');
    const history = msgs.slice(-6);
    setMsgs(m => [...m, {role: 'user', content: question}]);
    try {
      const r = await fetch('/api/parliament/strategy', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question, history, briefing: briefing(data, pl, a)})});
      const raw = await r.text();
      let j: {answer?: string; detail?: string; error?: string} = {};
      try { j = JSON.parse(raw); } catch { throw new Error(r.status === 504 || r.status === 502 ? 'The AI took too long to answer. Please try again.' : `Server error (HTTP ${r.status}). Please try again.`); }
      if (!r.ok || !j.answer) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setMsgs(m => [...m, {role: 'assistant', content: j.answer!}]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (enabled === false) return <div className="st-chat off"><div className="omni-section-label">AI STRATEGIST</div><p className="parl-muted">Not configured on this server (OpenRouter key missing).</p></div>;
  return <div className="st-chat">
    <div className="omni-section-label">AI STRATEGIST <span>answers only from the numbers above</span></div>
    <div className="st-msgs" ref={box}>
      {!msgs.length && <div className="st-sugg">{SUGGESTIONS.map(s => <button key={s} onClick={() => ask(s)} disabled={!enabled}>{s}</button>)}</div>}
      {msgs.map((m, i) => <div key={i} className={`st-msg ${m.role}`}>{m.content.split('\n').map((l, k) => <p key={k}>{l.replace(/\*\*(.+?)\*\*/g, '$1')}</p>)}</div>)}
      {busy && <div className="st-msg assistant st-typing"><i /><i /><i /></div>}
      {err && <p className="st-err">{err}</p>}
    </div>
    <form className="st-ask" onSubmit={e => { e.preventDefault(); ask(q); }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={enabled ? 'Ask about this vote…' : 'Connecting…'} disabled={!enabled || busy} maxLength={600} aria-label="Ask the strategist" />
      <button type="submit" disabled={!enabled || busy || !q.trim()}>↗</button>
    </form>
  </div>;
}
