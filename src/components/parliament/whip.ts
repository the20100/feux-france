/**
 * Whip planner: how many votes are missing to pass / block an amendment, and whom to work on first.
 * Inputs are Omni's seat-level projection (calibrated on Orcet's mean) and each deputy's real
 * participation. Everything here is an estimate built on an estimate; the UI says so.
 */
import type {Galaxy} from './types';

export type Goal = 'pass' | 'block';
export type Target = {
  i: number;
  kind: 'persuade' | 'mobilise';
  p: number;            // projected P(for), 0-100
  part: number;         // participation 0-1
  gain: number;         // ranking score (expected votes × movability)
  raw: number;          // expected net votes gained for the goal
  why: string[];
  messenger: {i: number; agree: number} | null;
};
export type Plan = {
  goal: Goal;
  expFor: number; expAgainst: number; expVoters: number;
  margin: number;            // expected (for - against) seen from the goal: >0 = goal reached
  votesShort: number;        // expected votes missing (0 if reached)
  flipsNeeded: number;       // deputies to win over or bring in (greedy, in ranking order) to reach the goal in expectation; -1 if 40 aren't enough
  winNow: number;            // Monte Carlo probability the goal is reached
  curve: {k: number; win: number}[]; // win prob after acting on the top-k targets (persuade + mobilise, ranked)
  actions: Target[];         // combined ranking used by the curve
  persuade: Target[];
  mobilise: Target[];
  groups: {id: string; gain: number; n: number}[];
};

const CONVERTED = 85; // P(for) assumed once a deputy is convinced (15 when blocking)

function simulate(p: number[], part: number[], goal: Goal, runs: number, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    let f = 0, a = 0;
    for (let i = 0; i < p.length; i++) if (rnd() < part[i]) { if (rnd() * 100 < p[i]) f++; else a++; }
    if (goal === 'pass' ? f > a : f <= a) wins++;
  }
  return wins / runs;
}

export function plan(data: Galaxy, p: number[], goal: Goal, agreement: (i: number, j: number) => number | null): Plan {
  const N = p.length;
  const part = data.deputies.map(d => Math.min(0.95, Math.max(0.03, d.participation)));
  const toward = (x: number) => goal === 'pass' ? x / 100 : 1 - x / 100; // P(vote goes our way)
  let expFor = 0, expAgainst = 0;
  for (let i = 0; i < N; i++) { expFor += part[i] * p[i] / 100; expAgainst += part[i] * (1 - p[i] / 100); }
  const ours = goal === 'pass' ? expFor : expAgainst, theirs = goal === 'pass' ? expAgainst : expFor;
  const margin = ours - theirs;
  const votesShort = margin > 0 ? 0 : Math.ceil(-margin + 0.5);

  // allies = deputies already likely on our side, used as messengers
  const allies = data.deputies.map((_, i) => i).filter(i => toward(p[i]) >= 0.75);

  const messengerFor = (i: number) => {
    let best: {i: number; agree: number} | null = null;
    for (const j of data.deputies[i].near.map(([j]) => j).concat(allies.slice(0, 0))) if (toward(p[j]) >= 0.7) { const a = agreement(i, j); if (a != null && (!best || a > best.agree)) best = {i: j, agree: a}; }
    if (!best) for (const j of allies) { const a = agreement(i, j); if (a != null && (!best || a > best.agree)) best = {i: j, agree: a}; }
    return best;
  };

  const persuade: Target[] = [];
  const mobilise: Target[] = [];
  data.deputies.forEach((d, i) => {
    const t = toward(p[i]);
    // persuade: against-leaning but movable. Value = votes swung if convinced, weighted by how movable they look.
    if (t < 0.6) {
      const movable = 0.25 + 4 * t * (1 - t) + (d.loyalty != null ? Math.max(0, 0.97 - d.loyalty) * 4 : 0);
      const gain = part[i] * ((goal === 'pass' ? CONVERTED : 100 - CONVERTED) / 100 - t) * 2;
      const why: string[] = [];
      if (t >= 0.3) why.push('on the fence');
      if (d.loyalty != null && d.loyalty < 0.93) why.push(`breaks with ${d.group} ${Math.round((1 - d.loyalty) * 100)}% of the time`);
      if (part[i] >= 0.4) why.push('votes often');
      if (d.bridge && toward(p[d.bridge[0]]) >= 0.7) why.push(`close to ${data.deputies[d.bridge[0]].name}`);
      persuade.push({i, kind: 'persuade', p: p[i], part: part[i], gain: gain * movable, raw: gain, why, messenger: null} as Target);
    }
    // mobilise: already on our side but often absent. Value = net vote if they show up.
    if (t >= 0.7 && part[i] < 0.5) {
      const gain = (0.9 - part[i]) * (2 * t - 1);
      mobilise.push({i, kind: 'mobilise', p: p[i], part: part[i], gain, raw: gain, why: [`present for ${Math.round(part[i] * 100)}% of divisions`, `${Math.round(t * 100)}% likely to vote our way`], messenger: null});
    }
  });
  persuade.sort((a, b) => b.gain - a.gain);
  mobilise.sort((a, b) => b.gain - a.gain);
  const topP = persuade.slice(0, 25), topM = mobilise.slice(0, 15);
  topP.forEach(t => (t.messenger = messengerFor(t.i)));
  topM.forEach(t => (t.messenger = messengerFor(t.i)));

  // combined action list: persuasion and mobilisation ranked by score
  const actions = [...persuade, ...mobilise].sort((a, b) => b.gain - a.gain);
  let acc = margin, flipsNeeded = margin > 0 ? 0 : -1;
  for (let k = 0; k < Math.min(40, actions.length) && flipsNeeded < 0; k++) { acc += actions[k].raw; if (acc > 0) flipsNeeded = k + 1; }

  // win probability as we act on the top-k targets
  const curve: {k: number; win: number}[] = [];
  const q = p.slice(), qp = part.slice();
  for (let k = 0; k <= 40; k++) {
    const t = actions[k - 1];
    if (k > 0 && t) { if (t.kind === 'persuade') q[t.i] = goal === 'pass' ? CONVERTED : 100 - CONVERTED; else qp[t.i] = 0.9; }
    curve.push({k, win: simulate(q, qp, goal, 220, 7 + k)});
  }

  const gmap = new Map<string, {gain: number; n: number}>();
  for (const t of persuade.slice(0, 60)) { const g = data.deputies[t.i].group; const o = gmap.get(g) || {gain: 0, n: 0}; o.gain += t.gain; o.n++; gmap.set(g, o); }

  return {
    goal, expFor, expAgainst, expVoters: expFor + expAgainst, margin, votesShort, flipsNeeded,
    winNow: curve[0].win, curve, actions: actions.slice(0, 40), persuade: topP, mobilise: topM,
    groups: [...gmap].map(([id, v]) => ({id, ...v})).sort((a, b) => b.gain - a.gain),
  };
}

/** Compact, factual context for the AI strategist (no invented data). */
export function briefing(data: Galaxy, pl: Plan, amendment: {n: string; article: string; summary: string; signers: string; group: string; mean: number; conf: number}) {
  const name = (i: number) => `${data.deputies[i].name} (${data.deputies[i].group}, ${data.deputies[i].dept})`;
  return [
    `Amendment n°${amendment.n} (${amendment.article}) to the PLFSS 2027, tabled by ${amendment.signers} [${amendment.group}].`,
    `Summary: ${amendment.summary}`,
    `Orcet (Hémicycle model): mean probability of deputies voting for = ${Math.round(amendment.mean * 100)}%, model confidence ${Math.round(amendment.conf * 100)}%. This is not a probability of adoption.`,
    `User goal: ${pl.goal === 'pass' ? 'get it ADOPTED' : 'get it REJECTED'}.`,
    `Omni projection with real turnout: expected ${pl.expFor.toFixed(0)} for vs ${pl.expAgainst.toFixed(0)} against (~${pl.expVoters.toFixed(0)} voters). Goal reached in ${Math.round(pl.winNow * 100)}% of simulations. ${pl.votesShort ? `About ${pl.votesShort} expected votes short; ${pl.flipsNeeded > 0 ? `${pl.flipsNeeded} deputies to win over or bring in (top of the ranking)` : 'more than 40 deputies would be needed'}.` : 'The goal is reached in expectation.'}`,
    `Win probability after acting on the top 5 / 10 / 20 / 40 targets (persuade or mobilise): ${[5, 10, 20, 40].map(k => Math.round((pl.curve[k]?.win ?? 0) * 100) + '%').join(' / ')}.`,
    `Top persuasion targets (projected P(for), participation, reasons, best messenger):`,
    ...pl.persuade.slice(0, 12).map((t, k) => `${k + 1}. ${name(t.i)} — P(for) ${t.p}%, participation ${Math.round(t.part * 100)}%, ${t.why.join('; ') || 'movable'}${t.messenger ? `; messenger: ${name(t.messenger.i)} (votes alike ${Math.round(t.messenger.agree * 100)}%)` : ''}`),
    `Top mobilisation targets (allies who often miss votes):`,
    ...pl.mobilise.slice(0, 8).map((t, k) => `${k + 1}. ${name(t.i)} — P(for) ${t.p}%, participation ${Math.round(t.part * 100)}%`),
    `Groups with the most persuadable votes: ${pl.groups.slice(0, 5).map(g => `${g.id} (${g.n} targets)`).join(', ')}.`,
  ].join('\n');
}
