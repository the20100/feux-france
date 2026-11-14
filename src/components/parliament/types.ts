export type Vec3 = [number, number, number];
export type Deputy = {
  id: string; name: string; civ: string; group: string; dept: string; deptNum: string; circo: string;
  born: string; job: string; since: string; seat: number; votes: number; participation: number;
  loyalty: number | null; pos: Vec3 | null; near: [number, number][]; bridge: [number, number] | null;
};
export type Group = {id: string; name: string; color: string; size: number; centroid: Vec3};
export type KeyVote = {url?: string; n: number | string; date: string; type: string; title: string; sort: string; pour: number; contre: number; abst: number; ballots: string};
export type Galaxy = {
  chamber?: 'senate';
  legislature: number; generatedAt: string; range: [string, string]; scrutins: number; method: string;
  source: {name: string; url: string; license: string};
  groups: Group[]; deputies: Deputy[];
  globalGroups: [string, string, number, number][];
  periods: {id: string; scrutins: number; positions: (Vec3 | null)[]; groups: [string, string, number, number][]}[];
  keyVotes: KeyVote[];
};
const BLANK = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#14224e"/><circle cx="32" cy="25" r="11" fill="#5b79c4"/><path d="M10 64c2-16 12-22 22-22s20 6 22 22z" fill="#5b79c4"/></svg>');
export const photo = (id: string) => /^PA\d+$/.test(id) ? `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${id.replace(/\D/g, '')}.jpg` : BLANK;
export const anPage = (id: string) => `https://www.assemblee-nationale.fr/dyn/deputes/${id}`;
export const voteUrl = (k: {n: number | string; url?: string}) => k.url || `https://www.assemblee-nationale.fr/dyn/17/scrutins/${k.n}`;
export const scrutinPage = (n: number | string) => `https://www.assemblee-nationale.fr/dyn/17/scrutins/${n}`;
export const pct = (x: number | null | undefined) => x == null ? '—' : `${Math.round(x * 100)}%`;
export const BALLOT_LABEL: Record<string, string> = {p: 'For', c: 'Against', a: 'Abstain', '-': 'Did not vote'};
export const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
export type LivePrediction = {
  uid: string; n: string; mean: number; conf: number; author: string | null; group: string; signers: string; article: string; summary: string; state: string;
  authorIdx: number | null; p: number[]; lean: Record<string, number>; projectedFor: number;
};
export type TrackItem = {
  scrutin: number; label: string; type: string; mean: number; sup: number; inf: number; mid: number; conf: number;
  pour: number; contre: number; abst: number; adopted: boolean; hit: boolean; date?: string; title?: string;
  groups: Record<string, [string, number]>; actualGroups: Record<string, string> | null;
  watch: {id: string; i: number | null; name: string; group: string; p: number; gap: number; ballot: string}[];
};
export type Forecast = {
  fetchedAt: string; source: {name: string; url: string; license: string}; text: {uid: string; title: string; short: string};
  live: LivePrediction[]; track: TrackItem[]; trackNote: string; method: string; agenda: string[];
  signals: {t: string; s: number; trend: string; cat: string; cur: number; base: number; ev?: number[]}[];
};
export type Insights = {
  groups: string[]; weeks: {w: string; n: number; sps: number; adopted: number; rejected: number}[];
  cohesion: {q: string; v: (number | null)[]}[]; weekday: number[];
  tight: {n: number; date: string; title: string; pour: number; contre: number; abst: number; sort: string; margin: number}[];
};
export type Cosign = {
  source: {name: string; url: string; license: string}; method: string; total: number; withCo: number; cross: number; adopted: number;
  pos: Vec3[]; links: [number, number, number][]; dep: {a: number; c: number; ad: number; x: number; top: [number, number][]}[];
  pairs: [number, number, number][]; groups: [string, string, number][];
};
export type BillStage = {code: string; label: string; chamber: string; start: string; end: string; votes: number[]; outcome: string | null; final: {n: number; date: string; title: string; sort: string; pour: number; contre: number}[]};
export type Bill = {uid: string; title: string; procedure: string; stages: BillStage[]; last: string; status: string; done: boolean; an: string | null; senat: string | null; amendments: {n: number; adopted: number; cross: number} | null; votes: number; live: number};
export type Lobby = {
  source: {name: string; url: string; license: string}; method: string; registered: number; active: number; acts: number; parlActs: number;
  domains: {label: string; acts: number; orgs: number}[]; categories: {label: string; orgs: number; acts: number}[]; targets: {label: string; n: number}[];
  orgs: {name: string; cat: string; spend: string | null; staff: number | null; acts: number; all: number; domains: string[]; sectors: string[]; url: string}[];
  plfss: {name: string; cat: string; n: number; objects: string[]; url: string}[]; plfssTotal: number;
};
