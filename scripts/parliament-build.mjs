#!/usr/bin/env node
/**
 * PARLIAMENT: builds the static dataset for /parlement from Assemblée nationale open data
 * (17th legislature, Licence Ouverte 2.0). No API key, no credits.
 *
 *   npm run parliament:build            # downloads into data/parliament-src, writes public/parliament/*.json
 *   npm run parliament:build -- --offline   # reuse previously downloaded archives
 *
 * Outputs
 *   galaxy.json : deputies, 3D vote-space coordinates (global + per quarter), neighbours, groups,
 *                 group agreement per quarter, loyalty, participation, key votes with per-deputy ballots.
 *   agreement.bin : N×N bytes, pairwise agreement ×200 (255 = not enough shared votes), deputies in galaxy order.
 *
 * Method: agreement(i,j) = share of identical positions (for/against/abstain) on scrutins where both
 * cast one. Distance = 1 - agreement. Classical MDS (power iteration) gives the global 3D layout;
 * quarterly positions are Nyström projections of each quarter's distances onto the same axes, so the
 * animation never rotates arbitrarily. Censure motions are excluded (only "for" ballots are recorded).
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'data', 'parliament-src');
const OUT = path.join(ROOT, 'public', 'parliament');
const LEG = 17;
const URLS = {
  scrutins: `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}/loi/scrutins/Scrutins.json.zip`,
  acteurs: `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip`,
};
const offline = process.argv.includes('--offline');
fs.mkdirSync(SRC, {recursive: true});
fs.mkdirSync(OUT, {recursive: true});

async function fetchZip(name) {
  const zip = path.join(SRC, `${name}.zip`), dir = path.join(SRC, name);
  if (!offline) {
    const r = await fetch(URLS[name]);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  if (!fs.existsSync(zip)) throw new Error(`${name}: archive missing, run without --offline`);
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  execFileSync('unzip', ['-qo', zip, '-d', dir]);
  return dir;
}
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []);

const [scrDir, actDir] = [await fetchZip('scrutins'), await fetchZip('acteurs')];

// ---------- organes (groups) ----------
const organes = {};
for (const f of walk(path.join(actDir, 'json', 'organe'))) {
  const o = JSON.parse(fs.readFileSync(f, 'utf8')).organe;
  organes[o.uid] = o;
}
// ---------- deputies (active) ----------
const deputies = [];
for (const f of walk(path.join(actDir, 'json', 'acteur'))) {
  const a = JSON.parse(fs.readFileSync(f, 'utf8')).acteur;
  const uid = a.uid['#text'] ?? a.uid;
  const mandats = arr(a.mandats?.mandat);
  const an = mandats.find(m => m.typeOrgane === 'ASSEMBLEE' && String(m.legislature) === String(LEG) && !m.dateFin);
  if (!an) continue;
  const gp = mandats.filter(m => m.typeOrgane === 'GP' && !m.dateFin).sort((x, y) => (y.dateDebut || '').localeCompare(x.dateDebut || ''))[0];
  const g = gp && organes[gp.organes.organeRef];
  const lieu = an.election?.lieu || {};
  const ec = a.etatCivil.ident;
  deputies.push({
    id: uid, name: `${ec.prenom} ${ec.nom}`, sort: ec.alpha || ec.nom, civ: ec.civ,
    group: g?.libelleAbrege || 'NI', dept: lieu.departement || '', deptNum: lieu.numDepartement || '', circo: lieu.numCirco || '',
    born: a.etatCivil.infoNaissance?.dateNais || '', job: a.profession?.libelleCourant || '', since: an.mandature?.datePriseFonction || an.dateDebut || '',
  });
  if (g && !organes[`__g_${g.libelleAbrege}`]) organes[`__g_${g.libelleAbrege}`] = g;
}
deputies.sort((a, b) => a.sort.localeCompare(b.sort, 'fr'));
const idx = new Map(deputies.map((d, i) => [d.id, i]));
const N = deputies.length;
const groupsSeen = [...new Set(deputies.map(d => d.group))];
const groups = groupsSeen.map(ab => {
  const o = organes[`__g_${ab}`];
  return {id: ab, name: o?.libelle || 'Non inscrits', color: o?.couleurAssociee || '#8D949A', size: deputies.filter(d => d.group === ab).length};
});

// ---------- scrutins ----------
const CODE = {pours: 'p', contres: 'c', abstentions: 'a'};
const scrutins = [];
for (const f of walk(scrDir)) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8')).scrutin;
  const title = (s.titre || s.objet?.libelle || '').trim();
  if (/motion de censure/i.test(title)) continue;
  const ballots = new Uint8Array(N); // 0 none, 1 p, 2 c, 3 a
  const seats = [];
  let any = 0;
  for (const g of arr(s.ventilationVotes?.organe?.groupes?.groupe)) {
    const dn = g.vote?.decompteNominatif || {};
    for (const [k, c] of Object.entries(CODE)) {
      for (const v of arr(dn[k]?.votant)) {
        const i = idx.get(v.acteurRef);
        if (i === undefined) continue;
        ballots[i] = c === 'p' ? 1 : c === 'c' ? 2 : 3; any++;
        if (v.numPlace) seats.push([i, +v.numPlace]);
      }
    }
  }
  if (!any) continue;
  const syn = s.syntheseVote?.decompte || {};
  scrutins.push({
    n: +s.numero, date: s.dateScrutin, type: s.typeVote?.codeTypeVote, title, sort: s.sort?.code,
    pour: +syn.pour || 0, contre: +syn.contre || 0, abst: +syn.abstentions || 0, ballots, seats,
  });
}
scrutins.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
const S = scrutins.length;
console.log(`${N} deputies, ${S} nominal scrutins (${scrutins[0].date} → ${scrutins[S - 1].date})`);

// latest seat per deputy
const seat = new Int32Array(N).fill(0);
for (const s of scrutins) for (const [i, p] of s.seats) seat[i] = p;

// ---------- agreement matrices ----------
const quarterOf = d => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
const quarters = [...new Set(scrutins.map(s => quarterOf(s.date)))];
function agreement(list) {
  const same = new Float64Array(N * N), both = new Float64Array(N * N);
  for (const s of list) {
    const voters = [];
    for (let i = 0; i < N; i++) if (s.ballots[i]) voters.push(i);
    for (let a = 0; a < voters.length; a++) {
      const i = voters[a], bi = s.ballots[i], row = i * N;
      for (let b = a + 1; b < voters.length; b++) {
        const j = voters[b];
        both[row + j]++;
        if (bi === s.ballots[j]) same[row + j]++;
      }
    }
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { same[j * N + i] = same[i * N + j]; both[j * N + i] = both[i * N + j]; }
  return {same, both};
}
const glob = agreement(scrutins);
const votesCast = deputies.map((_, i) => scrutins.reduce((n, s) => n + (s.ballots[i] ? 1 : 0), 0));
const MIN_PAIR = 15;

// group-level fallback distance for sparse pairs
function distMatrix({same, both}, minPair) {
  const gi = deputies.map(d => groupsSeen.indexOf(d.group)), G = groupsSeen.length;
  const gs = new Float64Array(G * G), gc = new Float64Array(G * G);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j && both[i * N + j] >= minPair) {
    gs[gi[i] * G + gi[j]] += 1 - same[i * N + j] / both[i * N + j]; gc[gi[i] * G + gi[j]]++;
  }
  const D = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i === j) continue;
    const k = i * N + j;
    D[k] = both[k] >= minPair ? 1 - same[k] / both[k] : gc[gi[i] * G + gi[j]] ? gs[gi[i] * G + gi[j]] / gc[gi[i] * G + gi[j]] : 0.5;
  }
  return D;
}
const D = distMatrix(glob, MIN_PAIR);

// classical MDS, top-3 eigenpairs by power iteration with deflation
const B = new Float64Array(N * N);
{
  const rowMean = new Float64Array(N); let all = 0;
  for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += D[i * N + j] ** 2; rowMean[i] = s / N; all += s; }
  all /= N * N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) B[i * N + j] = -0.5 * (D[i * N + j] ** 2 - rowMean[i] - rowMean[j] + all);
  var sqRowMean = rowMean;
}
const eig = [];
for (let k = 0; k < 3; k++) {
  let v = new Float64Array(N).map((_, i) => Math.sin(i * (k + 1.3)) + 0.01);
  let lambda = 0;
  for (let it = 0; it < 500; it++) {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) { let s = 0; const r = i * N; for (let j = 0; j < N; j++) s += B[r + j] * v[j]; w[i] = s; }
    for (const e of eig) { let dot = 0; for (let i = 0; i < N; i++) dot += e.v[i] * v[i]; for (let i = 0; i < N; i++) w[i] -= e.l * dot * e.v[i]; }
    const norm = Math.hypot(...w);
    const nv = w.map(x => x / norm);
    const diff = nv.reduce((s, x, i) => s + Math.abs(x - v[i]), 0);
    v = nv; lambda = norm;
    if (diff < 1e-9) break;
  }
  eig.push({v, l: lambda});
}
const SCALE = 260;
const coords = deputies.map((_, i) => eig.map(e => e.v[i] * Math.sqrt(Math.max(e.l, 1e-9))));
// orient axis 1 so that the left (LFI) is negative, axis 2 so RN is positive
const centroid = (ab, list = coords) => { const m = deputies.map((d, i) => d.group === ab ? list[i] : null).filter(Boolean); return [0, 1, 2].map(k => m.reduce((s, c) => s + c[k], 0) / (m.length || 1)); };
const lfi = groupsSeen.find(g => /LFI/.test(g)), rn = groupsSeen.find(g => g === 'RN');
const flip = [1, 1, 1];
if (lfi && centroid(lfi)[0] > 0) flip[0] = -1;
if (rn && centroid(rn)[1] < 0) flip[1] = -1;
const norm = Math.max(...coords.flat().map(Math.abs)) || 1;
const pos = c => c.map((x, k) => +(x * flip[k] / norm * SCALE).toFixed(1));

// Nyström projection for a quarter
function project(period) {
  const {same, both} = agreement(period);
  const out = [];
  for (let i = 0; i < N; i++) {
    let ok = 0;
    const delta = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      if (i === j) { delta[j] = 0; continue; }
      if (both[k] >= 8) { delta[j] = (1 - same[k] / both[k]) ** 2; ok++; } else delta[j] = D[k] ** 2;
    }
    if (ok < 20) { out.push(null); continue; }
    out.push(pos(eig.map(e => { let s = 0; for (let j = 0; j < N; j++) s += e.v[j] * (sqRowMean[j] - delta[j]); return 0.5 * s / Math.sqrt(Math.max(e.l, 1e-9)); })));
  }
  return out;
}

// group majority positions per scrutin (for loyalty and group agreement)
const gIndex = deputies.map(d => groupsSeen.indexOf(d.group));
function majority(s) {
  const G = groupsSeen.length, cnt = Array.from({length: G}, () => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) if (s.ballots[i]) cnt[gIndex[i]][s.ballots[i]]++;
  return cnt.map(c => { const m = Math.max(c[1], c[2], c[3]); if (!m) return 0; const w = [1, 2, 3].filter(k => c[k] === m); return w.length === 1 ? w[0] : 0; });
}
const majorities = scrutins.map(majority);
const loyalty = deputies.map((d, i) => {
  let tot = 0, ok = 0;
  scrutins.forEach((s, k) => { const m = majorities[k][gIndex[i]]; if (s.ballots[i] && m && d.group !== 'NI') { tot++; if (s.ballots[i] === m) ok++; } });
  return tot >= 20 ? +(ok / tot).toFixed(3) : null;
});
function groupAgreement(list, mj) {
  const G = groupsSeen.length, m = [];
  for (let a = 0; a < G; a++) for (let b = a + 1; b < G; b++) {
    let n = 0, same = 0;
    list.forEach((_, k) => { const x = mj[k][a], y = mj[k][b]; if (x && y) { n++; if (x === y) same++; } });
    if (n >= 10) m.push([groupsSeen[a], groupsSeen[b], +(same / n).toFixed(3), n]);
  }
  return m;
}

// ---------- assemble ----------
const periods = quarters.map(q => {
  const list = scrutins.filter(s => quarterOf(s.date) === q), mj = list.map(majority);
  console.log(`  ${q}: ${list.length} scrutins`);
  return {id: q, scrutins: list.length, positions: list.length >= 15 ? project(list) : null, groups: groupAgreement(list, mj)};
}).filter(p => p.positions);

const neighbours = deputies.map((_, i) => {
  const c = [];
  // rank by agreement shrunk towards 0.5 so a handful of shared votes cannot make a 'twin'
  for (let j = 0; j < N; j++) if (j !== i && glob.both[i * N + j] >= 40) { const k = i * N + j; c.push([j, glob.same[k] / glob.both[k], (glob.same[k] + 40) / (glob.both[k] + 80)]); }
  c.sort((a, b) => b[2] - a[2]);
  return c.slice(0, 5).map(([j, a]) => [j, +a.toFixed(3)]);
});
// cross-group affinity: closest deputy outside own group
const bridges = deputies.map((d, i) => {
  let best = null;
  for (let j = 0; j < N; j++) if (deputies[j].group !== d.group && glob.both[i * N + j] >= 40) {
    const k = i * N + j, a = glob.same[k] / glob.both[k], r = (glob.same[k] + 40) / (glob.both[k] + 80);
    if (!best || r > best[2]) best = [j, a, r];
  }
  return best ? [best[0], +best[1].toFixed(3)] : null;
});

const code = b => ' pca'[b] || '-';
const keyVotes = scrutins.filter(s => s.type === 'SPS' || /l'ensemble/i.test(s.title)).slice(-160).reverse().map(s => ({
  n: s.n, date: s.date, type: s.type, title: s.title, sort: s.sort, pour: s.pour, contre: s.contre, abst: s.abst,
  ballots: Array.from(s.ballots, b => b ? code(b) : '-').join(''),
}));

const galaxy = {
  legislature: LEG,
  generatedAt: new Date().toISOString(),
  source: {name: 'Assemblée nationale — données ouvertes (scrutins, acteurs, organes)', url: 'https://data.assemblee-nationale.fr', license: 'Licence Ouverte / Open Licence 2.0'},
  range: [scrutins[0].date, scrutins[S - 1].date], scrutins: S,
  method: 'Agreement = share of identical positions on scrutins where both deputies voted (min. 15 shared). 3D = classical MDS of 1 − agreement; quarters = Nyström projections on the same axes. Censure motions excluded.',
  groups: groups.map(g => ({...g, centroid: pos(centroid(g.id))})).sort((a, b) => a.centroid[0] - b.centroid[0]),
  deputies: deputies.map((d, i) => ({...d, sort: undefined, seat: seat[i], votes: votesCast[i], participation: +(votesCast[i] / S).toFixed(3), loyalty: loyalty[i], pos: votesCast[i] >= 20 ? pos(coords[i]) : null, near: neighbours[i], bridge: bridges[i]})),
  globalGroups: groupAgreement(scrutins, majorities),
  periods: periods.map(p => ({id: p.id, scrutins: p.scrutins, positions: p.positions, groups: p.groups})),
  keyVotes,
};
// pairwise agreement matrix, 1 byte per pair: round(agreement*200), 255 = fewer than 15 shared votes
const agree = new Uint8Array(N * N).fill(255);
for (let k = 0; k < N * N; k++) if (glob.both[k] >= MIN_PAIR) agree[k] = Math.round(glob.same[k] / glob.both[k] * 200);
for (let i = 0; i < N; i++) agree[i * N + i] = 200;
fs.writeFileSync(path.join(OUT, 'galaxy.json'), JSON.stringify(galaxy));
fs.writeFileSync(path.join(OUT, 'agreement.bin'), agree);
fs.rmSync(path.join(OUT, 'votes.json'), {force: true});
for (const f of ['galaxy.json', 'agreement.bin']) console.log(`${f}: ${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2)} MB`);
