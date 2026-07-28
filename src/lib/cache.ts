import { db } from "./db";

/** Cache clé/valeur persistant (partagé entre tous les utilisateurs). */
export function miscGet<T = any>(key: string, ttlSec: number): T | null {
  const row = db().prepare("SELECT ts, payload FROM misc_cache WHERE key = ?").get(key) as any;
  if (row && Date.now() / 1000 - row.ts < ttlSec) return JSON.parse(row.payload);
  return null;
}

export function miscSet(key: string, payload: any): void {
  db().prepare("INSERT OR REPLACE INTO misc_cache (key, ts, payload) VALUES (?,?,?)")
    .run(key, Math.floor(Date.now() / 1000), JSON.stringify(payload));
}

/** fetch avec backoff sur 429 (quotas Open-Meteo notamment). */
export async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i === tries - 1) return r;
    await new Promise((res) => setTimeout(res, 2000 + i * 3000));
  }
  throw new Error("unreachable");
}
