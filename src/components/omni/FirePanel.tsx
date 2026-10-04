'use client';
import dynamic from 'next/dynamic';
const WarRoom=dynamic(()=>import('@/components/WarRoom'),{ssr:false});
export default function FirePanel(){return <WarRoom/>;}
