import { NextRequest, NextResponse } from "next/server";
import { getSummary } from "@/lib/summary";
import { RANGES } from "@/lib/firms";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const id = p.get("id") || "";
  const range = RANGES[p.get("range") || ""] ? p.get("range")! : "24h";
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json(await getSummary(id, range));
}
