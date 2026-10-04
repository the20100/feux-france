import {mkdir,stat,readFile,rename,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {appendTerritory,archiveDocument} from './store.mjs';
const run=promisify(execFile);
async function download(url,file,limit){
  const r=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!r.ok)throw new Error(`VIINA HTTP ${r.status}`);
  let size=0;
  const guard=new Transform({transform(chunk,_encoding,cb){size+=chunk.length;cb(size>limit?new Error('VIINA file exceeds size limit'):null,chunk);}});
  const temp=file+'.download';
  try{await pipeline(Readable.fromWeb(r.body),guard,createWriteStream(temp));await rename(temp,file);}catch(e){await unlink(temp).catch(()=>{});throw e;}
}
export async function collectViina(db){
  const dir=resolve('data/viina');await mkdir(dir,{recursive:true});
  const geo=join(dir,'places.geojson');
  if(!(await stat(geo).catch(()=>null)))await download('https://raw.githubusercontent.com/zhukovyuri/VIINA/main/Data/gn_UA_tess.geojson',geo,60_000_000);
  const year=new Date().getUTCFullYear();
  const url=`https://media.githubusercontent.com/media/zhukovyuri/VIINA/main/Data/control_latest_${year}.zip`;
  await download(url,join(dir,'control.zip'),100_000_000);
  const {stdout}=await run('python3',[resolve('scripts/viina-extract.py'),dir],{timeout:240000,maxBuffer:1_000_000});
  const result=JSON.parse(stdout);
  const snapshots=await Promise.all(result.paths.map(file=>readFile(file,'utf8').then(JSON.parse)));
  const added=db.transaction(()=>snapshots.reduce((n,s)=>n+appendTerritory(db,s),0))();
  archiveDocument(db,'viina',url,{latest:result.latest,snapshots:snapshots.map(s=>s.metadata),license:'ODbL 1.0',geometrySource:'https://github.com/zhukovyuri/VIINA/blob/main/Data/gn_UA_tess.geojson'});
  return added;
}
