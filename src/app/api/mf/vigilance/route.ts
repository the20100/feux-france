import { NextResponse } from "next/server";
import { getMfVigilance } from "@/lib/meteoFrance";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMfVigilance());
}
