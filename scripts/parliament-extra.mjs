#!/usr/bin/env node
/**
 * PARLIAMENT, second pass: Senate, amendment co-signatures, bill tracker, lobbying register.
 * Runs after parliament-build.mjs (needs public/parliament/galaxy.json). No API key.
 *
 *   node scripts/parliament-extra.mjs            # download + build
 *   node scripts/parliament-extra.mjs --offline  # reuse data/parliament-src
 *
 * Sources (all Licence Ouverte 2.0):
 *   Senate ballots  : nosparlementaires.fr/opendata (rebuilt from data.senat.fr)
 *   Amendments, bills: data.assemblee-nationale.fr (17th legislature)
 *   Lobbying        : HATVP, répertoire des représentants d'intérêts (agora_repertoire_opendata.json)
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'data', 'parliament-src');
const OUT = path.join(ROOT, 'public', 'parliament');
const offline = process.argv.includes('--offline');
fs.mkdirSync(SRC, {recursive: true});
const URLS = {
  'senateurs.json': 'https://nosparlementaires.fr/opendata/senateurs.json',
  'scrutins_senat.json': 'https://nosparlementaires.fr/opendata/scrutins_senat.json',
  'votes_senat.csv.gz': 'https://nosparlementaires.fr/opendata/votes_senat.csv.gz',
  'amendements.zip': 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip',
  'dossiers.zip': 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip',
  'hatvp.json': 'https://www.hatvp.fr/agora/opendata/agora_repertoire_opendata.json',
};
for (const [f, u] of Object.entries(URLS)) {
  const p = path.join(SRC, f);
  if (offline && fs.existsSync(p)) continue;
  if (offline) throw new Error(`${f} missing, run without --offline`);
  console.log('downloading', f);
  execFileSync('curl', ['-sL', '--fail', '-o', p, u], {stdio: 'inherit'});
}
// extracted outside the project: 150,000 small files inside the repo make `next build` run out of memory
const TMP = path.join(os.tmpdir(), 'omni-parliament');
const unzip = name => { const dir = path.join(TMP, name); const marker = path.join(dir, '.done'); const zip = path.join(SRC, `${name}.zip`);
  if (!fs.existsSync(marker) || fs.statSync(marker).mtimeMs < fs.statSync(zip).mtimeMs) { fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true}); execFileSync('unzip', ['-qo', zip, '-d', dir]); fs.writeFileSync(marker, ''); }
  return dir; };
const walk = function* (d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith('.json')) yield p; } };
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const LICENSE = 'Licence Ouverte / Open Licence 2.0';

/* ---------- shared maths ---------- */
function agreementOf(ballotsList, N) {
  const same = new Float64Array(N * N), both = new Float64Array(N * N);
  for (const b of ballotsList) {
    const v = []; for (let i = 0; i < N; i++) if (b[i]) v.push(i);
    for (let a = 0; a < v.length; a++) { const i = v[a], bi = b[i], row = i * N; for (let c = a + 1; c < v.length; c++) { const j = v[c]; both[row + j]++; if (bi === b[j]) same[row + j]++; } }
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { same[j * N + i] = same[i * N + j]; both[j * N + i] = both[i * N + j]; }
  return {same, both};
}
function mds3(D, N) {
  const B = new Float64Array(N * N), rm = new Float64Array(N); let all = 0;
  for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += D[i * N + j] ** 2; rm[i] = s / N; all += s; } all /= N * N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) B[i * N + j] = -0.5 * (D[i * N + j] ** 2 - rm[i] - rm[j] + all);
  const eig = [];
  for (let k = 0; k < 3; k++) {
    let v = new Float64Array(N).map((_, i) => Math.sin(i * (k + 1.3)) + 0.01), l = 0;
    for (let it = 0; it < 400; it++) {
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) { let s = 0; const r = i * N; for (let j = 0; j < N; j++) s += B[r + j] * v[j]; w[i] = s; }
      for (const e of eig) { let dot = 0; for (let i = 0; i < N; i++) dot += e.v[i] * v[i]; for (let i = 0; i < N; i++) w[i] -= e.l * dot * e.v[i]; }
      const n = Math.hypot(...w), nv = w.map(x => x / n), diff = nv.reduce((s, x, i) => s + Math.abs(x - v[i]), 0); v = nv; l = n; if (diff < 1e-9) break;
    }
    eig.push({v, l});
  }
  return Array.from({length: N}, (_, i) => eig.map(e => e.v[i] * Math.sqrt(Math.max(e.l, 1e-9))));
}

/* ================= 1 · SENATE ================= */
{
  const SINCE = '2023-10-01'; // after the September 2023 renewal
  const COLORS = {'CRCE-K': '#C62828', GEST: '#66BB6A', SER: '#F06292', RDSE: '#E6C35C', RDPI: '#8B5FD6', UCI: '#F0A23C', 'Les Indépendants': '#4FC3F7', 'Les Républicains': '#2F6FD6', UNT: '#313567', NI: '#8D949A'};
  const SHORT = {'Les Républicains': 'LR', 'Les Indépendants': 'INDEP', UCI: 'UC'};
  const ORDER = ['CRCE-K', 'GEST', 'SER', 'RDSE', 'RDPI', 'UCI', 'Les Indépendants', 'Les Républicains', 'UNT', 'NI'];
  const sen = JSON.parse(fs.readFileSync(path.join(SRC, 'senateurs.json'), 'utf8')).filter(s => s.active).sort((a, b) => a.last_name.localeCompare(b.last_name, 'fr'));
  const N = sen.length, idx = new Map(sen.map((s, i) => [s.slug, i]));
  const scr = JSON.parse(fs.readFileSync(path.join(SRC, 'scrutins_senat.json'), 'utf8')).filter(s => s.date >= SINCE).sort((a, b) => a.date.localeCompare(b.date));
  const sidx = new Map(scr.map((s, i) => [s.id, i]));
  const ballots = scr.map(() => new Uint8Array(N));
  const CODE = {POUR: 1, CONTRE: 2, ABSTENTION: 3};
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(SRC, 'votes_senat.csv.gz'))).toString('utf8').split('\n');
  for (let k = 1; k < lines.length; k++) { const [sid, slug, pos] = lines[k].split(','); const s = sidx.get(sid), i = idx.get(slug); if (s === undefined || i === undefined || !CODE[pos]) continue; ballots[s][i] = CODE[pos]; }
  const S = scr.length, gid = sen.map(s => s.group_short), gs = ORDER.filter(g => gid.includes(g)), gi = gid.map(g => gs.indexOf(g));
  const {same, both} = agreementOf(ballots, N);
  const MIN = 15, D = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j) { const k = i * N + j; D[k] = both[k] >= MIN ? 1 - same[k] / both[k] : gi[i] === gi[j] ? 0.08 : 0.5; }
  const coords = mds3(D, N);
  const cen = (g, list) => { const m = list.filter((_, i) => gid[i] === g); return [0, 1, 2].map(k => m.reduce((s, c) => s + c[k], 0) / (m.length || 1)); };
  const flip = [1, 1, 1]; if (cen('CRCE-K', coords)[0] > 0) flip[0] = -1; if (cen('Les Républicains', coords)[1] < 0) flip[1] = -1;
  const norm = Math.max(...coords.flat().map(Math.abs)) || 1, pos = c => c.map((x, k) => +(x * flip[k] / norm * 260).toFixed(1));
  const votes = sen.map((_, i) => ballots.reduce((n, b) => n + (b[i] ? 1 : 0), 0));
  const maj = b => gs.map((_, g) => { const c = [0, 0, 0, 0]; for (let i = 0; i < N; i++) if (gi[i] === g && b[i]) c[b[i]]++; const m = Math.max(c[1], c[2], c[3]); if (!m) return 0; const w = [1, 2, 3].filter(k => c[k] === m); return w.length === 1 ? w[0] : 0; });
  const majs = ballots.map(maj);
  const loyalty = sen.map((s, i) => { let t = 0, ok = 0; ballots.forEach((b, k) => { const m = majs[k][gi[i]]; if (b[i] && m && s.group_short !== 'NI') { t++; if (b[i] === m) ok++; } }); return t >= 20 ? +(ok / t).toFixed(3) : null; });
  const near = sen.map((_, i) => { const c = []; for (let j = 0; j < N; j++) if (j !== i && both[i * N + j] >= 40) { const k = i * N + j; c.push([j, same[k] / both[k], (same[k] + 40) / (both[k] + 80)]); } c.sort((a, b) => b[2] - a[2]); return c.slice(0, 5).map(([j, a]) => [j, +a.toFixed(3)]); });
  const bridge = sen.map((s, i) => { let b = null; for (let j = 0; j < N; j++) if (gid[j] !== s.group_short && both[i * N + j] >= 40) { const k = i * N + j, r = (same[k] + 40) / (both[k] + 80); if (!b || r > b[2]) b = [j, same[k] / both[k], r]; } return b ? [b[0], +b[1].toFixed(3)] : null; });
  const gg = []; for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) { let n = 0, sm = 0; majs.forEach(m => { if (m[a] && m[b]) { n++; if (m[a] === m[b]) sm++; } }); if (n >= 10) gg.push([SHORT[gs[a]] || gs[a], SHORT[gs[b]] || gs[b], +(sm / n).toFixed(3), n]); }
  const ch = ' pca', fix = t => t.replace(/[\u0091\u0092]/g, '’').replace(/^sur\s+/i, '');
  const keyVotes = scr.map((s, k) => ({s, k})).filter(({s}) => /ensemble/i.test(s.title)).slice(-160).reverse().map(({s, k}) => ({n: s.id, date: s.date.slice(0, 10), type: 'SPO', title: fix(s.title), sort: s.pour > s.contre ? 'adopté' : 'rejeté', pour: s.pour, contre: s.contre, abst: Math.max(0, (s.votants || 0) - (s.suffrages_exprimes || 0)), url: s.url, ballots: Array.from(ballots[k], b => b ? ch[b] : '-').join('')}));
  const senate = {
    chamber: 'senate', legislature: 0, generatedAt: new Date().toISOString(),
    source: {name: 'Sénat, scrutins publics (data.senat.fr, mis en forme par NosParlementaires)', url: 'https://nosparlementaires.fr/donnees-ouvertes', license: LICENSE},
    range: [scr[0].date.slice(0, 10), scr[S - 1].date.slice(0, 10)], scrutins: S,
    method: 'Same method as the Assemblée: agreement = share of identical positions on public votes both senators took part in (min. 15 shared); 3D = classical MDS of 1 − agreement. Votes since the September 2023 renewal. Senate groups often vote as a bloc through delegated ballots, so clusters are tighter than at the Assemblée.',
    groups: gs.map(g => ({id: SHORT[g] || g, name: sen.find(s => s.group_short === g).group_label, color: COLORS[g] || '#8D949A', size: gid.filter(x => x === g).length, centroid: pos(cen(g, coords))})),
    deputies: sen.map((s, i) => ({id: s.slug, name: s.full_name, civ: '', group: SHORT[s.group_short] || s.group_short, dept: s.department_label || '', deptNum: s.department_code || '', circo: '', born: '', job: '', since: '', seat: i + 1, votes: votes[i], participation: +(votes[i] / S).toFixed(3), loyalty: loyalty[i], pos: votes[i] >= 20 ? pos(coords[i]) : null, near: near[i], bridge: bridge[i]})),
    globalGroups: gg, periods: [], keyVotes,
  };
  const agree = new Uint8Array(N * N).fill(255);
  for (let k = 0; k < N * N; k++) if (both[k] >= MIN) agree[k] = Math.round(same[k] / both[k] * 200);
  for (let i = 0; i < N; i++) agree[i * N + i] = 200;
  fs.writeFileSync(path.join(OUT, 'senate.json'), JSON.stringify(senate)); fs.writeFileSync(path.join(OUT, 'senate-agreement.bin'), agree);
  console.log(`senate.json: ${N} senators, ${S} public votes, ${keyVotes.length} final votes`);
}

/* ================= 2 + 3 · AMENDMENTS (co-signatures) and BILLS ================= */
const galaxy = JSON.parse(fs.readFileSync(path.join(OUT, 'galaxy.json'), 'utf8'));
const DN = galaxy.deputies.length, didx = new Map(galaxy.deputies.map((d, i) => [d.id, i]));
const docDossier = new Map();
const dosDir = unzip('dossiers');
for (const f of walk(path.join(dosDir, 'json', 'document'))) { const d = JSON.parse(fs.readFileSync(f, 'utf8')).document; if (d?.uid && d.dossierRef) docDossier.set(d.uid, d.dossierRef); }
const perDossier = new Map();
{
  const amDir = unzip('amendements');
  const w = new Map(), cnt = new Map(); // pair key i*DN+j (i<j) -> weighted / raw
  const dep = galaxy.deputies.map(() => ({authored: 0, cosigned: 0, adopted: 0, cross: 0, pairs: new Map()}));
  let total = 0, withCo = 0, crossAm = 0, adopted = 0;
  const gOf = i => galaxy.deputies[i].group;
  for (const f of walk(amDir)) {
    let a; try { a = JSON.parse(fs.readFileSync(f, 'utf8')).amendement; } catch { continue; }
    if (!a?.signataires) continue;
    total++;
    const sort = a.cycleDeVie?.sort; const isAd = typeof sort === 'string' && /adopt/i.test(sort); if (isAd) adopted++;
    const dos = docDossier.get(a.texteLegislatifRef);
    // committee amendments are relayed by a rapporteur and list members of every group: not a personal co-signature
    const personal = a.signataires.auteur?.typeAuteur === 'Député';
    const au = personal ? didx.get(a.signataires.auteur?.acteurRef) : undefined;
    const cos = arr(a.signataires.cosignataires?.acteurRef).map(x => didx.get(x)).filter(x => x !== undefined && x !== au);
    let cross = false;
    if (au !== undefined) {
      dep[au].authored++; if (isAd) dep[au].adopted++;
      if (cos.length) {
        withCo++; const k = cos.length, wt = 1 / Math.sqrt(k);
        for (const c of cos) {
          dep[c].cosigned++;
          const i = Math.min(au, c), j = Math.max(au, c), key = i * DN + j;
          w.set(key, (w.get(key) || 0) + wt); cnt.set(key, (cnt.get(key) || 0) + 1);
          if (gOf(au) !== gOf(c) && gOf(au) !== 'NI' && gOf(c) !== 'NI') { cross = true; dep[c].cross++; }
        }
        if (cross) { crossAm++; dep[au].cross++; }
      }
    }
    if (dos) { const o = perDossier.get(dos) || {n: 0, adopted: 0, cross: 0}; o.n++; if (isAd) o.adopted++; if (cross) o.cross++; perDossier.set(dos, o); }
  }
  for (const [key, n] of cnt) { const i = Math.floor(key / DN), j = key % DN; dep[i].pairs.set(j, n); dep[j].pairs.set(i, n); }
  // 3D force layout seeded with the vote galaxy: shows where co-signing departs from voting
  const P = galaxy.deputies.map((d, i) => (d.pos || galaxy.groups.find(g => g.id === d.group).centroid).map(x => x * 0.9 + Math.sin(i * 7.3) * 4));
  const E = [...w].map(([key, v]) => [Math.floor(key / DN), key % DN, Math.log1p(v)]);
  for (let it = 0; it < 220; it++) {
    const F = P.map(() => [0, 0, 0]), cool = 1 - it / 220;
    for (let i = 0; i < DN; i++) for (let j = i + 1; j < DN; j++) { const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], dz = P[i][2] - P[j][2], d2 = dx * dx + dy * dy + dz * dz + 9, f = 2600 / d2 / Math.sqrt(d2); F[i][0] += dx * f; F[i][1] += dy * f; F[i][2] += dz * f; F[j][0] -= dx * f; F[j][1] -= dy * f; F[j][2] -= dz * f; }
    for (const [i, j, s] of E) { const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], dz = P[j][2] - P[i][2], f = 0.004 * s; F[i][0] += dx * f; F[i][1] += dy * f; F[i][2] += dz * f; F[j][0] -= dx * f; F[j][1] -= dy * f; F[j][2] -= dz * f; }
    for (let i = 0; i < DN; i++) { for (let k = 0; k < 3; k++) F[i][k] -= P[i][k] * 0.004; const m = Math.hypot(...F[i]), cap = 14 * cool + 0.6, s = m > cap ? cap / m : 1; for (let k = 0; k < 3; k++) P[i][k] += F[i][k] * s; }
  }
  const ext = P.map(p => Math.hypot(...p)).sort((a, b) => a - b), mx = (ext[Math.floor(ext.length * 0.93)] || 1) / 0.78;
  const cross = [...cnt].map(([key, n]) => [Math.floor(key / DN), key % DN, n]).filter(([i, j]) => gOf(i) !== gOf(j) && gOf(i) !== 'NI' && gOf(j) !== 'NI').sort((a, b) => b[2] - a[2]);
  const strong = [...w].map(([key, v]) => [Math.floor(key / DN), key % DN, v]).sort((a, b) => b[2] - a[2]);
  const links = [...strong.filter(([i, j]) => gOf(i) === gOf(j)).slice(0, 1100).map(([i, j]) => [i, j, 0]), ...cross.slice(0, 500).map(([i, j]) => [i, j, 1])];
  const gm = new Map(); for (const [key, n] of cnt) { const a = gOf(Math.floor(key / DN)), b = gOf(key % DN), k = a < b ? `${a}|${b}` : `${b}|${a}`; gm.set(k, (gm.get(k) || 0) + n); }
  fs.writeFileSync(path.join(OUT, 'cosign.json'), JSON.stringify({
    source: {name: 'Assemblée nationale, amendements (données ouvertes)', url: 'https://data.assemblee-nationale.fr', license: LICENSE},
    method: 'One link per author and co-signatory of the same amendment, among sitting deputies. Committee and government amendments are left out, and non-attached deputies are not counted as a group. Layout: force-directed in 3D, seeded with the vote galaxy; link strength counts each amendment as 1/√(number of co-signatories) so whole-group amendments do not swamp the map. Signing together is a public act, not proof of coordination.',
    total, withCo, cross: crossAm, adopted,
    pos: P.map(p => { const r = Math.hypot(...p) / mx, k = r > 1 ? (1 + Math.log(r) * 0.25) / r : 1; return p.map(x => +(x / mx * k * 260).toFixed(1)); }), links,
    dep: dep.map(d => ({a: d.authored, c: d.cosigned, ad: d.adopted, x: d.cross, top: [...d.pairs].sort((a, b) => b[1] - a[1]).slice(0, 6)})),
    pairs: cross.slice(0, 40), groups: [...gm].map(([k, n]) => [...k.split('|'), n]).filter(([a, b]) => a !== 'NI' && b !== 'NI').sort((a, b) => b[2] - a[2]),
  }));
  console.log(`cosign.json: ${total} amendments, ${withCo} co-signed, ${crossAm} across groups`);
}
{
  const CH = c => c.startsWith('AN') ? 'AN' : c.startsWith('SN') ? 'Sénat' : c.startsWith('CMP') ? 'CMP' : c.startsWith('CC') ? 'Conseil constitutionnel' : c.startsWith('PROM') ? 'Promulgation' : 'Other';
  const EN = {AN1: 'Assemblée, first reading', SN1: 'Senate, first reading', AN2: 'Assemblée, second reading', SN2: 'Senate, second reading', AN3: 'Assemblée, third reading', SN3: 'Senate, third reading', CMP: 'Joint committee', ANNLEC: 'Assemblée, new reading', SNNLEC: 'Senate, new reading', ANLDEF: 'Assemblée, final reading', CC: 'Constitutional Council', PROM: 'Promulgation', ANLUNI: 'Assemblée, single reading', SNLUNI: 'Senate, single reading', AN20: 'Assemblée, 20 days', AN21: 'Assemblée'};
  const forecast = fs.existsSync(path.join(OUT, 'forecast.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'forecast.json'), 'utf8')) : null;
  const liveDossier = forecast ? docDossier.get(forecast.text.uid) : null;
  const bills = [];
  for (const f of walk(path.join(dosDir, 'json', 'dossierParlementaire'))) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8')).dossierParlementaire;
    if (String(d.legislature) !== '17' || !d.actesLegislatifs) continue;
    const proc = d.procedureParlementaire?.libelle || '';
    if (!/loi/i.test(proc)) continue;
    const stages = [];
    for (const top of arr(d.actesLegislatifs.acteLegislatif)) {
      const dates = [], votes = []; let adopted = null;
      (function rec(a) { for (const x of arr(a)) { if (x.dateActe) dates.push(x.dateActe.slice(0, 10)); for (const v of arr(x.voteRefs?.voteRef)) { const m = /V(\d+)$/.exec(v); if (m) votes.push(+m[1]); } const st = x.statutConclusion?.libelle; if (st && /adopt|rejet/i.test(st)) adopted = st; if (x.actesLegislatifs) rec(x.actesLegislatifs.acteLegislatif); } })(top);
      if (!dates.length) continue; dates.sort();
      stages.push({code: top.codeActe, label: EN[top.codeActe] || top.libelleActe?.nomCanonique || top.codeActe, chamber: CH(top.codeActe || ''), start: dates[0], end: dates[dates.length - 1], votes, outcome: adopted});
    }
    if (!stages.length) continue;
    stages.sort((a, b) => a.start.localeCompare(b.start));
    const last = stages.reduce((m, s) => s.end > m ? s.end : m, '');
    if (last < '2025-01-01') continue;
    const am = perDossier.get(d.uid) || null, nv = stages.reduce((n, s) => n + s.votes.length, 0);
    if (stages.length < 2 && !nv && !am) continue;
    const prom = stages.some(s => s.code === 'PROM');
    bills.push({uid: d.uid, title: d.titreDossier?.titre || '', procedure: proc, stages, last, status: prom ? 'Promulgated' : stages[stages.length - 1].label,
      done: prom, an: d.titreDossier?.titreChemin ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${d.titreDossier.titreChemin}` : null, senat: d.titreDossier?.senatChemin || null,
      amendments: am, votes: nv, live: liveDossier === d.uid ? forecast.live.length : 0});
  }
  bills.sort((a, b) => (b.live - a.live) || b.last.localeCompare(a.last));
  const kv = new Map(galaxy.keyVotes.map(k => [k.n, k]));
  const out = bills.slice(0, 260).map(b => ({...b, stages: b.stages.map(s => ({...s, votes: s.votes.slice(-6), final: s.votes.map(n => kv.get(n)).filter(Boolean).map(k => ({n: k.n, date: k.date, title: k.title, sort: k.sort, pour: k.pour, contre: k.contre})).slice(-2)}))}));
  fs.writeFileSync(path.join(OUT, 'bills.json'), JSON.stringify({source: {name: 'Assemblée nationale, dossiers législatifs (données ouvertes)', url: 'https://data.assemblee-nationale.fr', license: LICENSE}, generatedAt: new Date().toISOString(), bills: out}));
  console.log(`bills.json: ${out.length} bills (of ${bills.length} active since 2025)`);
}

/* ================= 4 · LOBBYING REGISTER (HATVP) ================= */
{
  const P = JSON.parse(fs.readFileSync(path.join(SRC, 'hatvp.json'), 'utf8')).publications;
  const isParl = r => /^Député, sénateur/.test(r);
  const year = e => +String(e.dateDebut || '').slice(-4);
  const dom = new Map(), cat = new Map(), orgs = [], plfss = [], targets = new Map();
  let acts = 0, parlActs = 0;
  const RX = /PLFSS|financement de la s[ée]curit[ée] sociale/i;
  for (const p of P) {
    let n = 0, all = 0; const d = new Map(), hits = []; let spend = null, staff = null, spendYear = 0;
    for (const ex of p.exercices || []) {
      const e = ex.publicationCourante || {}, y = year(e);
      if (e.montantDepense && y >= spendYear) { spend = e.montantDepense; staff = e.nombreSalaries ?? null; spendYear = y; }
      if (y < 2024) continue;
      for (const a of e.activites || []) {
        const c = a.publicationCourante || {}; all++; acts++;
        const ars = c.actionsRepresentationInteret || [];
        for (const ar of ars) for (const r of ar.reponsablesPublics || []) { const k = r.replace(/ - .*/, '').replace(/, collaborateur du Président de l'Assemblée.*/, ' and parliamentary staff'); targets.set(k, (targets.get(k) || 0) + 1); }
        if (!ars.some(ar => (ar.reponsablesPublics || []).some(isParl))) continue;
        n++; parlActs++;
        for (const x of c.domainesIntervention || []) d.set(x, (d.get(x) || 0) + 1);
        if (y >= 2025 && RX.test(c.objet || '')) hits.push((c.objet || '').replace(/\s+/g, ' ').trim().slice(0, 220));
      }
    }
    if (!n) continue;
    const name = p.nomUsageHatvp || p.denomination, c = p.categorieOrganisation?.label || 'Other';
    for (const [k, v] of d) { const o = dom.get(k) || {acts: 0, orgs: 0}; o.acts += v; o.orgs++; dom.set(k, o); }
    const co = cat.get(c) || {orgs: 0, acts: 0}; co.orgs++; co.acts += n; cat.set(c, co);
    const o = {name, cat: c, spend, staff, acts: n, all, domains: [...d].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]), sectors: (p.activites?.listSecteursActivites || []).slice(0, 2).map(s => s.label), url: `https://www.hatvp.fr/fiche-organisation/?organisation=${p.identifiantNational}`};
    orgs.push(o);
    if (hits.length) plfss.push({name, cat: c, n: hits.length, objects: hits.slice(0, 2), url: o.url});
  }
  orgs.sort((a, b) => b.acts - a.acts); plfss.sort((a, b) => b.n - a.n);
  fs.writeFileSync(path.join(OUT, 'lobby.json'), JSON.stringify({
    source: {name: 'HATVP, répertoire des représentants d’intérêts', url: 'https://www.hatvp.fr/le-repertoire/', license: LICENSE},
    method: 'Activity sheets filed for 2024 and later. An activity counts as aimed at Parliament when at least one of its declared actions lists "Député, sénateur" or parliamentary staff among the public officials approached. The register is declarative: it names categories of officials, never individual parliamentarians, and spending is declared in brackets.',
    registered: P.length, active: orgs.length, acts, parlActs,
    domains: [...dom].map(([label, v]) => ({label, ...v})).sort((a, b) => b.acts - a.acts).slice(0, 30),
    categories: [...cat].map(([label, v]) => ({label, ...v})).sort((a, b) => b.acts - a.acts),
    targets: [...targets].map(([label, n]) => ({label, n})).sort((a, b) => b.n - a.n).slice(0, 8),
    orgs: orgs.slice(0, 200), plfss: plfss.slice(0, 60), plfssTotal: plfss.length,
  }));
  console.log(`lobby.json: ${orgs.length} organisations aimed at Parliament since 2024, ${parlActs} activities, ${plfss.length} mention the PLFSS`);
}
for (const f of ['senate.json', 'senate-agreement.bin', 'cosign.json', 'bills.json', 'lobby.json']) console.log(`  ${f}: ${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2)} MB`);
