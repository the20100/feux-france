import { englishPresentation } from '@/lib/omni/presentation.mjs';
import { NextRequest, NextResponse } from 'next/server';
import { openStore, readDashboard, observationHistory } from '@/lib/omni/store.mjs';
import { topics } from '@/lib/omni/catalog.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const domain = p.get('domain') || 'global', topic = p.get('topic') || '';
  if (!['global','pandemic','war'].includes(domain) || (topic && !topics.some(t=>t.id===topic && (domain==='global'||t.domain===domain)))) return NextResponse.json({error:'Invalid panel or topic'},{status:400});
  for (const key of ['at','knownAt']) if (p.has(key) && (!/^\d{4}-\d{2}-\d{2}T/.test(p.get(key)!) || !Number.isFinite(Date.parse(p.get(key)!)))) return NextResponse.json({error:'Invalid ISO date'},{status:400});
  if (p.has('history') && !/^[1-9]\d*$/.test(p.get('history')!)) return NextResponse.json({error:'Invalid identifier'},{status:400});
  const db = openStore();
  try {
    const data = p.has('history') ? {versions:observationHistory(db,Number(p.get('history')))} : readDashboard(db,{domain,topic,at:p.get('at'),knownAt:p.get('knownAt')});
    return NextResponse.json(englishPresentation(data),{headers:{'Cache-Control':'no-store'}});
  } finally { db.close(); }
}
