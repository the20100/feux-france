import {NextResponse} from 'next/server';
export const runtime='nodejs';
export async function GET(_req:Request,{params}:{params:Promise<{z:string;x:string;y:string}>}){
  const p=await params;
  if(![p.z,p.x,p.y].every(v=>/^\d{1,7}$/.test(v)))return new NextResponse(null,{status:400});
  const z=Number(p.z),x=Number(p.x),y=Number(p.y);
  if(z>19||x>=2**z||y>=2**z)return new NextResponse(null,{status:400});
  const key=process.env.CARTO_API_KEY;if(!key)return new NextResponse(null,{status:503});
  try{
    const url=new URL(`https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`);url.searchParams.set('key',key);
    const origin=new URL(process.env.CARTO_MAP_ORIGIN||'https://omni.vima.work').origin;
    const r=await fetch(url,{headers:{Referer:origin+'/',Origin:origin},signal:AbortSignal.timeout(12000),next:{revalidate:86400}});
    if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))return new NextResponse(null,{status:502});
    return new NextResponse(await r.arrayBuffer(),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}});
  }catch{return new NextResponse(null,{status:502});}
}
