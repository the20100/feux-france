import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
// SQLite online backup API includes committed WAL writes; copying a live .db does not.
const root = resolve(process.env.OMNI_BACKUP_DIR || 'data/backups');
const dir = join(root,new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(dir,{recursive:true});
for (const file of ['feux.db','omni.db']) {
  const source = file === 'omni.db' && process.env.OMNI_DB_PATH ? process.env.OMNI_DB_PATH : join('data',file);
  if (!existsSync(source)) continue;
  const db = new Database(source,{readonly:true});
  try { await db.backup(join(dir,file)); } finally { db.close(); }
  const copy = new Database(join(dir,file),{readonly:true});
  try { if (copy.pragma('integrity_check',{simple:true}) !== 'ok') throw new Error(`Sauvegarde invalide : ${file}`); } finally { copy.close(); }
  console.log(`Sauvegarde vérifiée : ${join(dir,file)}`);
}
