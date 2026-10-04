import { openStore } from '../src/lib/omni/store.mjs';
import { syncSources } from '../src/lib/omni/collect.mjs';
const db = openStore();
let stopping = false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});
const daemon = process.argv.includes('--daemon');
do {
  const results = await syncSources(db,{force:process.argv.includes('--force')});
  for (const result of results) console.log(JSON.stringify({time:new Date().toISOString(),...result}));
  if (!daemon) { if (results.some(r=>r.status==='error')) process.exitCode=1; break; }
  for (let i=0;i<60 && !stopping;i++) await new Promise(r=>setTimeout(r,1000));
} while (!stopping);
db.close();
