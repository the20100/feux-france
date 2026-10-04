import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export function GET(){return NextResponse.json({available:!!process.env.CARTO_API_KEY,template:'/api/omni/tiles/{z}/{x}/{y}'},{headers:{'Cache-Control':'no-store'}});}
