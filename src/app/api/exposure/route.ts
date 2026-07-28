import { NextRequest, NextResponse } from "next/server";
import { communesWithin } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const lat = parseFloat(p.get("lat") || "");
  const lon = parseFloat(p.get("lon") || "");
  const r = Math.min(30, parseFloat(p.get("r") || "10"));
  if (!isFinite(lat) || !isFinite(lon))
    return NextResponse.json({ error: "lat/lon requis" }, { status: 400 });
  const communes = communesWithin(lat, lon, r);
  return NextResponse.json({
    communes: communes.slice(0, 25), radius_km: r,
    total_pop: communes.reduce((s, c) => s + c.population, 0),
    n_communes: communes.length,
  });
}
