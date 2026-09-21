import {readdir,copyFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve('vendor/box3d'),sources=(await readdir(resolve(root,'src'))).filter(name=>name.endsWith('.c')).map(name=>resolve(root,'src',name));
await mkdir('src/vendor',{recursive:true});await mkdir('public',{recursive:true});
const args=[resolve(root,'web_bridge.c'),...sources,`-I${resolve(root,'include')}`,`-I${resolve(root,'src')}`,'-std=gnu17','-O3','-ffp-contract=off','-msimd128','-msse2','-DNDEBUG',
  '-s','MODULARIZE=1','-s','EXPORT_ES6=1','-s','ENVIRONMENT=web','-s','FILESYSTEM=0','-s','ALLOW_MEMORY_GROWTH=1','-s','INITIAL_MEMORY=67108864','-s','MAXIMUM_MEMORY=1073741824',
  '-s','EXPORTED_RUNTIME_METHODS=["HEAPF32"]',
  '-s','EXPORTED_FUNCTIONS=["_lab_create","_lab_destroy","_lab_config","_lab_cursor","_lab_step","_lab_state","_lab_count"]','-o',resolve('src/vendor/box3d.js')];
const result=spawnSync('emcc',args,{stdio:'inherit',env:{...process.env,EM_CACHE:process.env.EM_CACHE??resolve('.cache/emscripten')}});
if(result.error)throw result.error;if(result.status)process.exit(result.status);
await copyFile('src/vendor/box3d.wasm','public/box3d.wasm');
console.log('Built Box3D WebAssembly bridge.');
