import { NextRequest, NextResponse } from "next/server";
import { getRows, RANGES, fetchErrors } from "@/lib/firms";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") || "24h";
  const r = RANGES[range] ? range : "24h";
  try {
    const rows = await getRows(r);
    return NextResponse.json({
      type: "FeatureCollection",
      features: rows.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { t: p.epoch, frp: p.frp, sat: p.sat, conf: p.conf, dn: p.daynight },
      })),
      meta: { range: r, count: rows.length, errors: fetchErrors(r),
        generated: new Date().toISOString() },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
