import { NextRequest, NextResponse } from "next/server";
import { getWindGrid } from "@/lib/openMeteo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tRaw = req.nextUrl.searchParams.get("t");
  const t = tRaw != null ? parseFloat(tRaw) : undefined;
  return NextResponse.json(await getWindGrid(isFinite(t as number) ? t : undefined));
}
