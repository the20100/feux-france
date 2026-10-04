import { readFileSync } from 'node:fs';
import { openStore, appendTerritory } from '../src/lib/omni/store.mjs';
const file = process.argv[2];
if (!file) throw new Error('Usage: npm run omni:import -- /chemin/releve.geojson');
const db = openStore();
try {
  const data = JSON.parse(readFileSync(file,'utf8'));
  const snapshots = Array.isArray(data) ? data : [data];
  const count = db.transaction(()=>snapshots.reduce((n,s)=>n+appendTerritory(db,s),0))();
  console.log(`${count} relevé(s) archivé(s). Les versions antérieures sont conservées.`);
} finally { db.close(); }
