import { NextRequest, NextResponse } from "next/server";
import { getClusters } from "@/lib/clusters";
import { RANGES } from "@/lib/firms";
import { hasExa } from "@/lib/intel";
import { hasOpenRouter } from "@/lib/summary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") || "24h";
  const r = RANGES[range] ? range : "24h";
  try {
    const clusters = await getClusters(r);
    return NextResponse.json({
      clusters,
      meta: { range: r, count: clusters.length, generated: new Date().toISOString(),
        exa: hasExa(), openrouter: hasOpenRouter() },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
