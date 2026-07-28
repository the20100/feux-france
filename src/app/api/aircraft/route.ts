import { NextRequest, NextResponse } from "next/server";
import { getAircraft } from "@/lib/aircraft";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tRaw = req.nextUrl.searchParams.get("t");
  const t = tRaw != null ? parseFloat(tRaw) : undefined;
  return NextResponse.json(getAircraft(isFinite(t as number) ? t : undefined));
}
