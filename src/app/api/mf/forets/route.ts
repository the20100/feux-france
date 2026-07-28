import { NextResponse } from "next/server";
import { getMfForets } from "@/lib/meteoFrance";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMfForets());
}
