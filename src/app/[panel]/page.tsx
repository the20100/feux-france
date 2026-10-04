import {notFound} from 'next/navigation';
import Dashboard from '@/components/omni/Dashboard';
import FirePanel from '@/components/omni/FirePanel';
export default async function Page({params}:{params:Promise<{panel:string}>}){
  const {panel}=await params;
  if(panel==='feux')return <FirePanel/>;
  if(panel==='pandemic'||panel==='war')return <Dashboard key={panel} domain={panel}/>;
  notFound();
}
