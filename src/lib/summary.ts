import { miscGet, miscSet } from "./cache";
import { getFeed } from "./intel";
import { getClusters } from "./clusters";

const OPENROUTER_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const OPENROUTER_MODEL = (process.env.OPENROUTER_MODEL || "openai/gpt-5-nano").trim();
const AI_TTL = 6 * 3600;      // une synthèse par foyer vaut 6 h
const AI_DAILY_BUDGET = 4;    // générations IA max par jour pour toute l'app

export function hasOpenRouter(): boolean {
  return !!OPENROUTER_KEY;
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

/** Synthèse IA d'un foyer : cache 6 h partagé + budget global quotidien.
 *  Budget épuisé → dernière synthèse en base (marquée stale). */
export async function getSummary(fid: string, rangeKey: string) {
  if (!OPENROUTER_KEY) return { error: "no_key" };
  const fire = (await getClusters(rangeKey)).find((c) => c.id === fid);
  if (!fire) return { error: "Unknown fire cluster" };
  const key = `summary:en:${fid}`;
  const cached = miscGet(key, AI_TTL);
  if (cached) return cached;

  const day = new Date().toISOString().slice(0, 10);
  const bkey = `ai_budget:${day}`;
  const budget = miscGet<{ n: number }>(bkey, 86400) || { n: 0 };
  if (budget.n >= AI_DAILY_BUDGET) {
    const stale = miscGet(key, 30 * 86400);
    if (stale) return { ...stale, stale: true };
    return { error: "budget", detail: `Daily AI budget exhausted (${AI_DAILY_BUDGET} summaries/day)` };
  }

  const q = fire.commune ? `${fire.commune} ${fire.dept_name || ""}`.trim() : fire.dept_name || "";
  const feed = await getFeed(q, fire.commune, fire.dept_name, fire.dept);
  if (feed.error) return { error: feed.error };

  const fmt = (e: number) => new Date(e * 1000).toISOString().slice(5, 16).replace("T", " ");
  const lines = feed.results.slice(0, 12).map((r: any) =>
    `- [${r.type}] ${(r.date || "").slice(0, 16)} ${hostOf(r.url)} : ${r.title} — ${(r.text || "").slice(0, 200)}`);
  const prompt =
    `Satellite-detected fire: ${fire.name} (${fire.dept_name || "?"}), ` +
    `total FRP ${fire.frp} MW, ${fire.n} detections, first detection ${fmt(fire.first)}, ` +
    `latest overpass ${fmt(fire.last)}.\n\nCollected sources:\n${lines.join("\n")}\n\n` +
    `Based ONLY on these sources, return strict JSON. Write all text values in English, even when sources are in another language. Keep these JSON keys:\n` +
    `{"resume": "factual summary in at most 3 sentences, in English",` +
    ` "chiffres": [{"label": "hectares burned|evacuees|firefighters|homes destroyed|...", "valeur": "…", "source": "domain"}]}\n` +
    `Never invent figures: use only figures found in the sources. ` +
    `If sources do not discuss this specific fire, state this in the summary.`;

  let out: any;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await r.json();
    const raw = data.choices[0].message.content.trim().replace(/^```(?:json)?|```$/gm, "").trim();
    try {
      const parsed = JSON.parse(raw);
      out = { resume: parsed.resume, chiffres: parsed.chiffres || [], model: OPENROUTER_MODEL };
    } catch {
      out = { resume: raw.slice(0, 600), chiffres: [], model: OPENROUTER_MODEL };
    }
  } catch (e: any) {
    return { error: `openrouter: ${e.message}` };
  }
  out.generated_at = new Date().toISOString();
  miscSet(key, out);
  miscSet(bkey, { n: budget.n + 1 });
  return out;
}
