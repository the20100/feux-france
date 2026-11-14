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
