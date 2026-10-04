import { spawn } from 'node:child_process';
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
  const code=await new Promise(resolve=>{const child=spawn(process.execPath,['scripts/backup.mjs'],{stdio:'inherit'});child.on('exit',resolve);child.on('error',()=>resolve(1));});
  if(code!==0)console.error('Sauvegarde en échec ; nouvel essai dans une heure.');
  const wait=code===0?86400:3600;
  for(let i=0;i<wait&&!stopping;i++)await new Promise(r=>setTimeout(r,1000));
}
