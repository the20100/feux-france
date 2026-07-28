import { NextRequest, NextResponse } from "next/server";
import { getInfra } from "@/lib/extras";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") || "");
  const lon = parseFloat(req.nextUrl.searchParams.get("lon") || "");
  if (!isFinite(lat) || !isFinite(lon))
    return NextResponse.json({ error: "lat/lon requis" }, { status: 400 });
  return NextResponse.json(await getInfra(lat, lon));
}
