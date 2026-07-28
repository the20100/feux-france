import { db } from "./db";
import { miscGet, miscSet } from "./cache";
import { DEPTS } from "./geo";
import { getMfVigilance, getMfVigilanceTextes } from "./meteoFrance";

const EXA_KEY = (process.env.EXA_API_KEY || "").trim();
const INTEL_TTL = 1800;

const INTEL_TABS: Record<string, any> = {
  press: { days: 7, category: "news", domains: null,
    q: "incendie feu de forêt {q} actualité" },
  // Exa n'indexe plus les tweets ; en mode keyword le filtre domaine est
  // fiable et Facebook/Instagram/Bluesky ont du contenu → onglet "Social"
  x: { days: 7, category: null, type: "keyword",
    domains: ["x.com", "twitter.com", "facebook.com", "instagram.com",
      "tiktok.com", "reddit.com", "bsky.app"],
    q: "incendie feu {q}" },
  gouv: { days: 30, category: null,
    domains: ["gouv.fr", "interieur.gouv.fr", "meteofrance.fr"],
    q: "incendie feu de forêt {q} préfecture" },
  video: { days: 7, category: null,
    domains: ["youtube.com", "dailymotion.com", "tiktok.com"],
    q: "incendie feu {q} vidéo" },
};

export function hasExa(): boolean {
  return !!EXA_KEY;
}

async function getIntel(tab: string, q: string) {
  if (!EXA_KEY) return { error: "no_key" };
  const cacheKey = `${tab}:${q.toLowerCase()}`;
  const now = Math.floor(Date.now() / 1000);
  const row = db().prepare("SELECT ts, payload FROM intel_cache WHERE key = ?").get(cacheKey) as any;
  if (row && now - row.ts < INTEL_TTL) return JSON.parse(row.payload);
  const conf = INTEL_TABS[tab];
  const payload: any = {
    query: conf.q.replace("{q}", q),
    numResults: 8,
    type: conf.type || "auto",
    startPublishedDate: new Date(Date.now() - conf.days * 86400e3).toISOString(),
    contents: { text: { maxCharacters: 320 } },
  };
  if (conf.category) payload.category = conf.category;
  if (conf.domains) payload.includeDomains = conf.domains;
  let data: any;
  try {
    const r = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": EXA_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    data = await r.json();
  } catch (e: any) {
    return { error: `exa: ${e.message}` };
  }
  const results = (data.results || []).map((r: any) => ({
    title: r.title || r.url, url: r.url, date: r.publishedDate ?? null,
    author: r.author ?? null, text: (r.text || "").trim(),
    image: r.image ?? null, favicon: r.favicon ?? null,
  }));
  const out = { results, tab, q };
  db().prepare("INSERT OR REPLACE INTO intel_cache (key, ts, payload) VALUES (?,?,?)")
    .run(cacheKey, now, JSON.stringify(out));
  return out;
}

// ------------------------------------------------------- RSS préfectures

const FIRE_WORDS = /incendie|feu[xs]? |feu de|vigilance|s[ée]cheresse|risque/i;

function deptSlug(deptName: string): string {
  return deptName.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/'/g, "").replace(/ /g, "-");
}

/** Communiqués de la préfecture (flux RSS officiel), filtrés incendie/feu. */
async function getPrefectureRss(deptCode: string | null) {
  const name = DEPTS[deptCode || ""];
  if (!name) return [];
  const key = `rss:${deptCode}`;
  const cached = miscGet<any[]>(key, 1800);
  if (cached != null) return cached;
  const items: any[] = [];
  try {
    const r = await fetch(`https://www.${deptSlug(name)}.gouv.fr/layout/set/rss/Actualites`,
      { signal: AbortSignal.timeout(12000) });
    const xml = await r.text();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const field = (tag: string) => {
        const mm = m[1].match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
        return mm ? mm[1].trim() : "";
      };
      const title = field("title");
      const desc = field("description").replace(/<[^>]+>/g, " ").trim();
      if (!FIRE_WORDS.test(title + " " + desc)) continue;
      let date: string | null = null;
      const pd = Date.parse(field("pubDate"));
      if (isFinite(pd)) date = new Date(pd).toISOString();
      items.push({ title, url: field("link"), date, author: `Préfecture — ${name}`,
        text: desc.slice(0, 320), image: null, favicon: null, src: "rss" });
    }
  } catch { /* préfecture sans flux joignable : tant pis */ }
  miscSet(key, items);
  return items;
}

// -------------------------------------------------------- feed unifié

function fold(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Vrai si le résultat mentionne réellement le lieu du foyer :
 *  commune (insensible à la casse/accents) ou département (majuscule exigée
 *  pour éviter « Cher »/« cher », « Somme », « Nord »…). */
function mentionsPlace(item: any, commune: string | null, dept: string | null): boolean {
  const hay = fold([item.title, item.text, item.url].filter(Boolean).join(" "));
  if (commune) {
    const pat = new RegExp(`(?<![\\w])${fold(commune).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i");
    if (pat.test(hay)) return true;
  }
  if (dept) {
    const pat = new RegExp(`(?<![\\w])${fold(dept).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`);
    if (pat.test(hay)) return true;
  }
  return false;
}

/** Feed unifié : 4 recherches Exa + RSS préfecture + texte vigilance,
 *  dédoublonnés par URL, filtrés sur la mention du lieu, triés par date. */
export async function getFeed(q: string, commune: string | null, dept: string | null,
  deptCode: string | null) {
  if (!EXA_KEY) return { error: "no_key" };
  const [parts, rss] = await Promise.all([
    Promise.all(Object.keys(INTEL_TABS).map(async (t) => [t, await getIntel(t, q)] as const)),
    getPrefectureRss(deptCode),
  ]);
  const items: any[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const [tab, res] of parts) {
    if (res.error) { errors.push(`${tab}: ${res.error}`); continue; }
    for (const r of res.results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      items.push({ ...r, type: tab });
    }
  }
  let dropped = 0;
  let kept = items;
  if (commune || dept) {
    kept = items.filter((r) => mentionsPlace(r, commune, dept));
    dropped = items.length - kept.length;
  }
  // RSS préfecture et vigilance : pertinents par construction, pas de filtre
  for (const r of rss) {
    if (!seen.has(r.url)) { seen.add(r.url); kept.push({ ...r, type: "gouv" }); }
  }
  if (deptCode) {
    try {
      const vig = await getMfVigilance();
      for (const t of await getMfVigilanceTextes(deptCode)) {
        const url = `https://vigilance.meteofrance.fr/fr#vig-${deptCode}-${t.title.slice(0, 20)}`;
        if (seen.has(url)) continue;
        seen.add(url);
        kept.push({ title: `Vigilance Météo-France — ${t.title}`,
          url: "https://vigilance.meteofrance.fr/fr", date: vig.updated ?? null,
          author: "Météo-France", text: t.text, image: null, favicon: null, type: "gouv" });
      }
    } catch { /* non bloquant */ }
  }
  kept.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { results: kept, q, errors, dropped };
}
