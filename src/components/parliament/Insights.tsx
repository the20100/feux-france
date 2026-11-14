'use client';
import * as d3 from 'd3';
import {useEffect, useRef, useState} from 'react';
import type {Galaxy, Insights as InsightsData} from './types';
import {cap, pct, scrutinPage} from './types';

const tc = (c?: string) => c ? `color-mix(in srgb, ${c} 55%, #ffffff)` : '#e1e7db';
const AXIS = '#5d6d64', INK = '#e1e7db', MUTED = '#a5b2a7';

/** Runs `draw` once when the card scrolls into view (and again on data change). */
function useReveal(draw: (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) => void | (() => void), deps: unknown[]) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current!; let cleanup: void | (() => void);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); const s = d3.select(el); s.selectAll('*').remove(); cleanup = draw(s); } }, {threshold: 0.2});
    io.observe(el);
    return () => { io.disconnect(); if (typeof cleanup === 'function') cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export default function Insights({data, onPick}: {data: Galaxy; onPick: (i: number) => void}) {
  const [ins, setIns] = useState<InsightsData | null>(null);
  const [agree, setAgree] = useState<Uint8Array | null>(null);
  useEffect(() => {
    fetch('/parliament/insights.json').then(r => r.json()).then(setIns).catch(() => {});
    fetch('/parliament/agreement.bin').then(r => r.arrayBuffer()).then(b => setAgree(new Uint8Array(b))).catch(() => {});
  }, []);
  if (!ins) return <div className="omni-map-loading">Crunching the legislature…</div>;
  const adopted = ins.weeks.reduce((s, w) => s + w.adopted, 0), total = ins.weeks.reduce((s, w) => s + w.n, 0);
  return <div className="ins-grid">
    <div className="ins-kpis">
      <Kpi v={total} label="recorded divisions" />
      <Kpi v={Math.round(adopted / total * 100)} suffix="%" label="adopted" />
      <Kpi v={d3.max(ins.weeks, w => w.n) || 0} label="divisions in the busiest week" />
      <Kpi v={Math.round((d3.median(data.deputies, d => d.loyalty ?? undefined) || 0) * 100)} suffix="%" label="median group loyalty" />
      <Kpi v={Math.round((d3.median(data.deputies, d => d.participation) || 0) * 100)} suffix="%" label="median participation" />
    </div>
    <Card title="The rhythm of the chamber" sub="Divisions per week, adopted above the line, rejected below." wide><Stream ins={ins} /></Card>
    <Card title="Who agrees with whom" sub="Chord of group agreement: ribbon width = share of divisions where both majorities matched. Hover a group."><Chord data={data} /></Card>
    <Card title="Discipline, deputy by deputy" sub="Each dot is a deputy: share of votes with their group's majority. Click one to open it in the galaxy."><Swarm data={data} onPick={onPick} /></Card>
    <Card title="Cohesion over time" sub="Average share of a group voting with its own majority, per quarter." wide><Cohesion data={data} ins={ins} /></Card>
    <Card title="Knife-edge votes" sub="The closest outcomes with more than 100 votes cast."><Tight ins={ins} /></Card>
    <Card title="When the chamber votes" sub="Divisions by weekday over the legislature."><Weekday ins={ins} /></Card>
    {agree && <Card title="The agreement landscape" sub="All 574 × 574 pairwise agreements, deputies ordered by group and position. Bright = vote alike." wide><Matrix data={data} agree={agree} /></Card>}
  </div>;
}

function Kpi({v, label, suffix = ''}: {v: number; label: string; suffix?: string}) {
  const [n, setN] = useState(0);
  useEffect(() => { let raf = 0; const t0 = performance.now(); const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1400); setN(Math.round(v * (1 - Math.pow(1 - k, 4)))); if (k < 1) raf = requestAnimationFrame(tick); }; tick(); return () => cancelAnimationFrame(raf); }, [v]);
  return <div className="ins-kpi"><b>{n.toLocaleString('en-GB')}{suffix}</b><small>{label}</small></div>;
}
function Card({title, sub, wide, children}: {title: string; sub: string; wide?: boolean; children: React.ReactNode}) {
  return <section className={`ins-card${wide ? ' wide' : ''}`}><h3>{title}</h3><p>{sub}</p>{children}</section>;
}

function Stream({ins}: {ins: InsightsData}) {
  const ref = useReveal(svg => {
    const W = 900, H = 240, m = {l: 34, r: 10, t: 10, b: 22};
    const x = d3.scaleTime([new Date(ins.weeks[0].w), new Date(ins.weeks[ins.weeks.length - 1].w)], [m.l, W - m.r]);
    const max = d3.max(ins.weeks, w => Math.max(w.adopted, w.rejected)) || 1;
    const y = d3.scaleLinear([-max, max], [H - m.b, m.t]);
    const area = (k: 'adopted' | 'rejected', s: number) => d3.area<(typeof ins.weeks)[number]>(w => x(new Date(w.w)), y(0), w => y(s * w[k])).curve(d3.curveBasis);
    const defs = svg.append('defs');
    [['ga', '#4fe39a'], ['gr', '#ef5b5b']].forEach(([id, c]) => { const g = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', id === 'ga' ? 0 : 1).attr('y2', id === 'ga' ? 1 : 0); g.append('stop').attr('offset', 0).attr('stop-color', c).attr('stop-opacity', .85); g.append('stop').attr('offset', 1).attr('stop-color', c).attr('stop-opacity', .05); });
    const clip = defs.append('clipPath').attr('id', 'reveal').append('rect').attr('x', 0).attr('y', 0).attr('height', H).attr('width', 0);
    clip.transition().duration(2200).ease(d3.easeCubicInOut).attr('width', W);
    const g = svg.append('g').attr('clip-path', 'url(#reveal)');
    g.append('path').datum(ins.weeks).attr('d', area('adopted', 1)).attr('fill', 'url(#ga)');
    g.append('path').datum(ins.weeks).attr('d', area('rejected', -1)).attr('fill', 'url(#gr)');
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', AXIS);
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(8).tickSize(0).tickFormat(d => d3.timeFormat('%b %y')(d as Date))).call(a => a.select('.domain').remove()).selectAll('text').attr('fill', MUTED);
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d => `${Math.abs(+d)}`).tickSize(-(W - m.l - m.r))).call(a => a.select('.domain').remove()).call(a => a.selectAll('line').attr('stroke', '#1f2a25')).selectAll('text').attr('fill', MUTED);
    // peak annotation
    const peak = ins.weeks.reduce((a, b) => b.n > a.n ? b : a);
    const px = x(new Date(peak.w));
    svg.append('circle').attr('cx', px).attr('cy', y(peak.adopted)).attr('r', 0).attr('fill', 'none').attr('stroke', INK).transition().delay(2200).attr('r', 5);
    svg.append('text').attr('x', px + 8).attr('y', y(peak.adopted) + 4).attr('fill', INK).attr('font-size', 11).attr('opacity', 0).text(`${peak.n} divisions, week of ${d3.timeFormat('%-d %b %Y')(new Date(peak.w))}`).transition().delay(2300).attr('opacity', 1);
  }, [ins]);
  return <svg ref={ref} viewBox="0 0 900 240" className="ins-svg" />;
}

function Chord({data}: {data: Galaxy}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useReveal(svg => {
    const ids = data.groups.map(g => g.id), n = ids.length;
    const M = ids.map(a => ids.map(b => a === b ? 0 : 0));
    for (const [a, b, v] of data.globalGroups) { const i = ids.indexOf(a), j = ids.indexOf(b); if (i >= 0 && j >= 0) { M[i][j] = Math.pow(v, 3); M[j][i] = Math.pow(v, 3); } }
    const R = 150, chord = d3.chord().padAngle(0.04).sortSubgroups(d3.descending)(M);
    const g = svg.append('g').attr('transform', 'translate(200,190)');
    const arc = d3.arc<d3.ChordGroup>().innerRadius(R).outerRadius(R + 12);
    const ribbon = d3.ribbon<d3.Chord, d3.ChordSubgroup>().radius(R - 2);
    const groups = g.append('g').selectAll('g').data(chord.groups).join('g');
    groups.append('path').attr('fill', d => data.groups[d.index].color).attr('stroke', '#0b110e')
      .transition().duration(1000).attrTween('d', d => { const i = d3.interpolate({...d, endAngle: d.startAngle}, d); return t => arc(i(t)) || ''; });
    groups.append('text').each(d => ((d as any).angle = (d.startAngle + d.endAngle) / 2)).attr('dy', '.35em')
      .attr('transform', d => { const a = (d as any).angle; return `rotate(${a * 180 / Math.PI - 90}) translate(${R + 18}) ${a > Math.PI ? 'rotate(180)' : ''}`; })
      .attr('text-anchor', d => (d as any).angle > Math.PI ? 'end' : null).attr('fill', d => tc(data.groups[d.index].color)).attr('font-size', 11).attr('font-weight', 600).text(d => ids[d.index]);
    const ribbons = g.append('g').attr('fill-opacity', 0.55).selectAll('path').data(chord).join('path')
      .attr('fill', d => data.groups[d.source.index].color).attr('stroke', '#0b110e').attr('stroke-width', .3).attr('d', d => ribbon(d) as unknown as string)
      .attr('opacity', 0).transition().delay((_, i) => 600 + i * 15).duration(600).attr('opacity', 1);
    groups.on('mouseenter', (_, d) => { setHover(d.index); g.selectAll<SVGPathElement, d3.Chord>('g:last-child path').transition().duration(200).attr('opacity', c => c.source.index === d.index || c.target.index === d.index ? 1 : 0.06); })
      .on('mouseleave', () => { setHover(null); g.selectAll('g:last-child path').transition().duration(200).attr('opacity', 1); });
    void ribbons; void n;
  }, [data]);
  const h = hover != null ? data.groups[hover] : null;
  const top = h ? data.globalGroups.filter(([a, b]) => a === h.id || b === h.id).map(([a, b, v]) => [a === h.id ? b : a, v] as const).sort((x, y) => y[1] - x[1]).slice(0, 3) : [];
  return <div className="ins-chord"><svg ref={ref} viewBox="0 0 400 380" className="ins-svg" />
    <div className="ins-chord-note">{h ? <><b style={{color: tc(h.color)}}>{h.name}</b>{top.map(([g, v]) => <span key={g}>{g} <b>{pct(v)}</b></span>)}</> : <span>Hover a group arc</span>}</div></div>;
}

function Swarm({data, onPick}: {data: Galaxy; onPick: (i: number) => void}) {
  const [tip, setTip] = useState<string>('');
  const ref = useReveal(svg => {
    const W = 420, H = 380, m = {l: 56, r: 12, t: 10, b: 24};
    const groups = data.groups.filter(g => g.id !== 'NI');
    const y = d3.scaleBand(groups.map(g => g.id), [m.t, H - m.b]).padding(0.1);
    const x = d3.scaleLinear([0.6, 1], [m.l, W - m.r]).clamp(true);
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0%')).tickSize(-(H - m.t - m.b))).call(a => a.select('.domain').remove()).call(a => a.selectAll('line').attr('stroke', '#1f2a25')).selectAll('text').attr('fill', MUTED);
    svg.append('g').selectAll('text').data(groups).join('text').attr('x', m.l - 8).attr('y', g => y(g.id)! + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').attr('fill', g => tc(g.color)).attr('font-size', 10).attr('font-weight', 600).text(g => g.id);
    type N = d3.SimulationNodeDatum & {i: number; tx: number; ty: number};
    const nodes: N[] = data.deputies.map((d, i) => ({d, i})).filter(({d}) => d.loyalty != null && d.group !== 'NI').map(({d, i}) => ({i, tx: x(d.loyalty!), ty: y(d.group)! + y.bandwidth() / 2, x: m.l, y: y(d.group)! + y.bandwidth() / 2}));
    const color = new Map(data.groups.map(g => [g.id, g.color]));
    const dots = svg.append('g').selectAll('circle').data(nodes).join('circle').attr('r', 2.6).attr('fill', n => color.get(data.deputies[n.i].group)!).attr('stroke', '#0b110e').attr('stroke-width', .4).style('cursor', 'pointer')
      .on('mouseenter', (_, n) => setTip(`${data.deputies[n.i].name} · ${data.deputies[n.i].group} · ${pct(data.deputies[n.i].loyalty)}`)).on('click', (_, n) => onPick(n.i));
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX<N>(n => n.tx).strength(0.9)).force('y', d3.forceY<N>(n => n.ty).strength(0.12)).force('c', d3.forceCollide(2.9)).alpha(1).alphaDecay(0.02)
      .on('tick', () => dots.attr('cx', n => n.x!).attr('cy', n => n.y!));
    return () => sim.stop();
  }, [data]);
  return <div><svg ref={ref} viewBox="0 0 420 380" className="ins-svg" /><p className="ins-tip">{tip || 'Hover a dot'}</p></div>;
}

function Cohesion({data, ins}: {data: Galaxy; ins: InsightsData}) {
  const ref = useReveal(svg => {
    const W = 900, H = 260, m = {l: 40, r: 70, t: 14, b: 24};
    const x = d3.scalePoint(ins.cohesion.map(c => c.q), [m.l, W - m.r]);
    const all = ins.cohesion.flatMap(c => c.v.filter((v): v is number => v != null));
    const y = d3.scaleLinear([Math.max(0.5, (d3.min(all) || 0.6) - 0.02), 1], [H - m.b, m.t]);
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickSize(0)).call(a => a.select('.domain').remove()).selectAll('text').attr('fill', MUTED);
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')).tickSize(-(W - m.l - m.r))).call(a => a.select('.domain').remove()).call(a => a.selectAll('line').attr('stroke', '#1f2a25')).selectAll('text').attr('fill', MUTED);
    const color = new Map(data.groups.map(g => [g.id, g.color]));
    const labels: {g: string; gi: number; x: number; y: number}[] = [];
    ins.groups.forEach((g, gi) => {
      const pts = ins.cohesion.map(c => [x(c.q)!, c.v[gi]] as const).filter(([, v]) => v != null) as [number, number][];
      const line = d3.line<[number, number]>(p => p[0], p => y(p[1])).curve(d3.curveCatmullRom);
      const path = svg.append('path').datum(pts).attr('d', line).attr('fill', 'none').attr('stroke', color.get(g) || '#888').attr('stroke-width', 2.2).attr('stroke-linecap', 'round');
      const L = (path.node() as SVGPathElement).getTotalLength();
      path.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().delay(gi * 120).duration(1600).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);
      const last = pts[pts.length - 1];
      if (last) labels.push({g, gi, x: last[0], y: y(last[1])});
    });
    // de-overlap end labels (min 11px apart)
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 11) labels[k].y = labels[k - 1].y + 11;
    labels.forEach(l => svg.append('text').attr('x', l.x + 6).attr('y', l.y).attr('dy', '.35em').attr('font-size', 10).attr('font-weight', 600).attr('fill', tc(color.get(l.g))).text(l.g).attr('opacity', 0).transition().delay(l.gi * 120 + 1500).attr('opacity', 1));
  }, [data, ins]);
  return <svg ref={ref} viewBox="0 0 900 260" className="ins-svg" />;
}

function Tight({ins}: {ins: InsightsData}) {
  return <ul className="ins-tight">{ins.tight.map((t, i) => { const tot = t.pour + t.contre; return <li key={t.n} style={{animationDelay: `${i * 70}ms`}}>
    <a href={scrutinPage(t.n)} target="_blank" rel="noreferrer">{cap(t.title)}</a>
    <div className="ins-tight-bar"><i data-b="p" style={{width: `${t.pour / tot * 100}%`}} /><i data-b="c" style={{width: `${t.contre / tot * 100}%`}} /></div>
    <small>{t.date} · {t.pour} for – {t.contre} against · <b className={t.sort === 'adopté' ? 'ok' : 'ko'}>{t.sort}</b> by {t.margin}</small>
  </li>; })}</ul>;
}

function Weekday({ins}: {ins: InsightsData}) {
  const ref = useReveal(svg => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const g = svg.append('g').attr('transform', 'translate(200,180)');
    const max = d3.max(ins.weekday) || 1, r = d3.scaleSqrt([0, max], [30, 150]);
    const arc = d3.arc<number>().innerRadius(30).padAngle(0.03).cornerRadius(4);
    ins.weekday.forEach((v, i) => {
      const a0 = (i / 7) * Math.PI * 2, a1 = ((i + 1) / 7) * Math.PI * 2;
      g.append('path').attr('fill', d3.interpolateCool(0.2 + 0.7 * v / max)).attr('opacity', .9)
        .transition().delay(i * 90).duration(900).ease(d3.easeBackOut).attrTween('d', () => { const ip = d3.interpolate(30, r(v)); return t => arc.outerRadius(ip(t)).startAngle(a0).endAngle(a1)(0) || ''; });
      const am = (a0 + a1) / 2 - Math.PI / 2;
      g.append('text').attr('x', Math.cos(am) * (r(v) + 14)).attr('y', Math.sin(am) * (r(v) + 14)).attr('text-anchor', 'middle').attr('dy', '.35em').attr('font-size', 10).attr('fill', MUTED).text(v ? `${days[i]} ${v}` : days[i]);
    });
  }, [ins]);
  return <svg ref={ref} viewBox="0 0 400 360" className="ins-svg" />;
}

/** 574×574 canvas heatmap, ordered by group then first MDS axis. */
function Matrix({data, agree}: {data: Galaxy; agree: Uint8Array}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const N = data.deputies.length, order = data.groups.map(g => g.id);
    const idx = data.deputies.map((_, i) => i).sort((a, b) => order.indexOf(data.deputies[a].group) - order.indexOf(data.deputies[b].group) || (data.deputies[a].pos?.[0] ?? 0) - (data.deputies[b].pos?.[0] ?? 0));
    const c = ref.current!, ctx = c.getContext('2d')!; c.width = N; c.height = N;
    const img = ctx.createImageData(N, N);
    const col = d3.scaleSequential(d3.interpolateMagma).domain([0.25, 1]);
    const lut = Array.from({length: 256}, (_, v) => v === 255 ? [11, 17, 14] : (() => { const k = d3.rgb(col(v / 200)); return [k.r, k.g, k.b]; })());
    let row = 0, raf = 0;
    const step = () => {
      for (let s = 0; s < 48 && row < N; s++, row++) {
        const i = idx[row];
        for (let col2 = 0; col2 < N; col2++) { const v = agree[i * N + idx[col2]], o = (row * N + col2) * 4, k = lut[v]; img.data[o] = k[0]; img.data[o + 1] = k[1]; img.data[o + 2] = k[2]; img.data[o + 3] = 255; }
      }
      ctx.putImageData(img, 0, 0);
      if (row < N) raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); raf = requestAnimationFrame(step); } }, {threshold: .1});
    io.observe(c);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [data, agree]);
  let acc = 0;
  return <div className="ins-matrix"><canvas ref={ref} aria-label="Pairwise agreement heatmap" />
    <div className="ins-matrix-legend">{data.groups.map(g => { const s = acc; acc += g.size; return <span key={g.id} style={{left: `${(s + g.size / 2) / data.deputies.length * 100}%`, color: tc(g.color)}}>{g.size > 15 ? g.id : ''}</span>; })}</div></div>;
}
