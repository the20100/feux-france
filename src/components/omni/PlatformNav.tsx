'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
const panels = [{id:'global',label:'GLOBAL',mark:'◎'},{id:'feux',label:'FIRES',mark:'▲'},{id:'pandemic',label:'PANDEMIC',mark:'✳'},{id:'war',label:'WAR',mark:'◇'}];
export default function PlatformNav() {
  const pathname=usePathname(); const router=useRouter();
  const active=pathname==='/'?'global':pathname.split('/')[1];
  return <nav className="omni-nav" aria-label="Control panels">
    <Link className="omni-wordmark" href="/">OMNI<span>OBSERVATORY</span></Link>
    <div className="omni-nav-tabs">{panels.map(p=><Link key={p.id} href={p.id==='global'?'/':`/${p.id}`} aria-current={active===p.id?'page':undefined} data-panel={p.id} onClick={e=>{
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      try { const saved=sessionStorage.getItem(`omni-url-${p.id}`); if(saved && saved.startsWith((p.id==='global'?'/':`/${p.id}`)+'?')) { e.preventDefault(); router.push(saved); } } catch {}
    }}><span aria-hidden="true">{p.mark}</span>{p.label}</Link>)}</div>
    <span className="omni-nav-caption">UNDERSTAND · LOCATE · REPLAY</span>
  </nav>;
}
