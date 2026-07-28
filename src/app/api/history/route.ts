import { NextRequest, NextResponse } from "next/server";
import { getHistory } from "@/lib/clusters";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") || "");
  const lon = parseFloat(req.nextUrl.searchParams.get("lon") || "");
  if (!isFinite(lat) || !isFinite(lon))
    return NextResponse.json({ error: "lat/lon requis" }, { status: 400 });
  return NextResponse.json(getHistory(lat, lon));
}
