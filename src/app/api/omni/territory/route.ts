import {NextRequest,NextResponse} from 'next/server';
import {openStore} from '@/lib/omni/store.mjs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const id=req.nextUrl.searchParams.get('snapshot');if(!id||!/^\d{1,12}$/.test(id))return NextResponse.json({error:'Identifier required'},{status:400});
  const db=openStore();try{
    const row=db.prepare('SELECT payload FROM territory_snapshots WHERE id=?').get(Number(id)) as {payload:string}|undefined;
    if(!row)return NextResponse.json({error:'Snapshot not found'},{status:404});
    return new NextResponse(row.payload,{headers:{'Content-Type':'application/geo+json','Content-Disposition':`attachment; filename="omni-territory-${id}.geojson"`,'Cache-Control':'public, max-age=86400'}});
  }finally{db.close();}
}
