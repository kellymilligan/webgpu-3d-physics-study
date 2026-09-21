import {readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'box3d-collision-check-'));
const sources=(await readdir('vendor/box3d/src')).filter(f=>f.endsWith('.c')).map(f=>`vendor/box3d/src/${f}`);
for(const [command,args] of [['cc',['-std=gnu17','-O2','-DNDEBUG','-Ivendor/box3d/include','-Ivendor/box3d/src','scripts/collision-regression.c',...sources,'-lm','-o',join(dir,'check')]],[join(dir,'check'),[]]]){
  const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status)process.exit(result.status);
}
