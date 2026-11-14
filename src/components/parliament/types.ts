export type Vec3 = [number, number, number];
export type Deputy = {
  id: string; name: string; civ: string; group: string; dept: string; deptNum: string; circo: string;
  born: string; job: string; since: string; seat: number; votes: number; participation: number;
  loyalty: number | null; pos: Vec3 | null; near: [number, number][]; bridge: [number, number] | null;
};
export type Group = {id: string; name: string; color: string; size: number; centroid: Vec3};
export type KeyVote = {n: number; date: string; type: string; title: string; sort: string; pour: number; contre: number; abst: number; ballots: string};
export type Galaxy = {
  legislature: number; generatedAt: string; range: [string, string]; scrutins: number; method: string;
  source: {name: string; url: string; license: string};
  groups: Group[]; deputies: Deputy[];
  globalGroups: [string, string, number, number][];
  periods: {id: string; scrutins: number; positions: (Vec3 | null)[]; groups: [string, string, number, number][]}[];
  keyVotes: KeyVote[];
};
export const photo = (id: string) => `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${id.replace(/\D/g, '')}.jpg`;
export const anPage = (id: string) => `https://www.assemblee-nationale.fr/dyn/deputes/${id}`;
export const scrutinPage = (n: number) => `https://www.assemblee-nationale.fr/dyn/17/scrutins/${n}`;
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
