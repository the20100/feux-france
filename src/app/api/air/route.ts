import { NextResponse } from "next/server";
import { getAirGrid } from "@/lib/openMeteo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAirGrid());
}
