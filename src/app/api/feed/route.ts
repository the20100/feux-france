import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "@/lib/intel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") || "").slice(0, 120);
  if (!q) return NextResponse.json({ error: "q manquant" }, { status: 400 });
  return NextResponse.json(await getFeed(q,
    p.get("commune")?.slice(0, 80) || null,
    p.get("dept")?.slice(0, 60) || null,
    p.get("dept_code")?.slice(0, 3) || null));
}
