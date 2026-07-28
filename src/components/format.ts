/** Helpers d'affichage partagés. */

export const fmtInt = (n: number) => n.toLocaleString("fr-FR");

export const fmtAgo = (epoch: number) => {
  const h = (Date.now() / 1000 - epoch) / 3600;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} j`;
};

export const fmtDT = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

export const host = (u: string) => {
  try { return new URL(u).hostname.replace("www.", ""); } catch { return ""; }
};

export const degToCard = (d: number) =>
  ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO",
    "O", "ONO", "NO", "NNO"][Math.round(d / 22.5) % 16];

export const scoreClass = (s: number | null | undefined) =>
  s == null ? "sc-low" : s >= 80 ? "sc-crit" : s >= 60 ? "sc-high" : s >= 40 ? "sc-mid" : "sc-low";

export const frpLabel = (frp: number) =>
  frp >= 1000 ? `${(frp / 1000).toFixed(1)} GW` : `${frp} MW`;

export const VIG_COLORS: Record<number, string> = {
  1: "#2e7d32", 2: "#f9d71c", 3: "#f57c00", 4: "#d32f2f",
};
export const DANGER_LABELS: Record<number, string> = {
  1: "Faible", 2: "Modéré", 3: "Élevé", 4: "Très élevé",
};

export type Cluster = {
  id: string; lat: number; lon: number; n: number; frp: number; frp_max: number;
  first: number; last: number; active: boolean; trend: "up" | "down" | "flat";
  hull: [number, number][]; area_km2: number; sats: string[]; buckets: number[];
  commune: string | null; dept: string | null; dept_name: string | null; name: string;
  population?: number | null; reprise?: boolean; score?: number; pop_5km?: number | null;
  danger_j1?: number | null; danger_j2?: number | null;
  vig?: { max: number; phen: any[]; cocktail: boolean; orage: boolean };
  wind?: number; wind_dir?: number; wind_src?: string; gusts?: number; obs?: any;
  isNew?: boolean;
};
