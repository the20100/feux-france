import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasExa } from "@/lib/intel";
import { hasOpenRouter } from "@/lib/summary";
import { hasMf } from "@/lib/meteoFrance";

export const dynamic = "force-dynamic";

export async function GET() {
  const hs = db().prepare("SELECT COUNT(*) c, MIN(epoch) mn, MAX(epoch) mx FROM hotspots").get() as any;
  const logs = db().prepare("SELECT range_key, fetched_at, rows_added FROM fetch_log").all();
  const counts: Record<string, number> = {};
  for (const t of ["geocode", "meteo_cache", "intel_cache", "communes", "clusters_history", "aircraft_tracks"])
    counts[t] = (db().prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  return NextResponse.json({
    hotspots: { count: hs.c, oldest: hs.mn, newest: hs.mx },
    fetch_log: logs, tables: counts,
    keys: { exa: hasExa(), openrouter: hasOpenRouter(), meteofrance: hasMf() },
  });
}
