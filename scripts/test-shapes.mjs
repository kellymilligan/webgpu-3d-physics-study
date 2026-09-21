import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message);});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('GPU',m.text());}});
await mkdir('test-results',{recursive:true});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count>0,{timeout:30000});
 const initial=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;s.paused=true;const before=await l.snapshot();await l.step(180);const after=await l.snapshot();
  const types=Array(8).fill(0);for(let i=0;i<after.length;i+=16)types[Math.round(after[i+8])]++;
  let rotationChanges=0,finite=true;for(let i=0;i<after.length;i+=16){for(let k=0;k<16;k++)finite&&=Number.isFinite(after[i+k]);if(Math.max(...[4,5,6,7].map(k=>Math.abs(before[i+k]-after[i+k])))>1e-4)rotationChanges++;}
  return {count:l.world.count,stride:after.length/l.world.count,types,rotationChanges,finite,errors:l.errors};
 });
 console.log('Mixed bodies',initial);assert.equal(initial.count,1000);assert.equal(initial.stride,16);assert.ok(initial.types.every(n=>n>70));assert.ok(initial.rotationChanges>100);assert.ok(initial.finite);assert.deepEqual(initial.errors,[]);
 await page.screenshot({path:'test-results/box3d-mixed-shapes-live.png'});
 const variation=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;for(const key of ['sphere','cube','sphube','capsule','cylinder','tetrahedron','octahedron','box'])s[`shape_${key}`]=key==='sphere';
  Object.assign(s,{count:1000,radius:.01,variation:100,variationBias:8,seed:71});await l.reset();const biased=await l.snapshot();
  s.variationBias=1;await l.reset();const uniform=await l.snapshot();
  const radii=a=>Array.from({length:a.length/16},(_,i)=>a[i*16+9]).sort((a,b)=>a-b),a=radii(biased),b=radii(uniform);
  return {min:a[0],max:a.at(-1),biasedMedian:a[500],uniformMedian:b[500],types:[...new Set(Array.from({length:biased.length/16},(_,i)=>biased[i*16+8]))],errors:l.errors};
 });
 console.log('Variation',variation);assert.deepEqual(variation.types,[0]);assert.ok(variation.max/variation.min>45);assert.ok(variation.biasedMedian<variation.uniformMedian*.35);assert.deepEqual(variation.errors,[]);
 const all=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;for(const key of ['sphere','cube','sphube','capsule','cylinder','tetrahedron','octahedron','box'])s[`shape_${key}`]=true;
  Object.assign(s,{count:250,radius:.12,variation:5,variationBias:2,seed:42,color:4});await l.reset();await l.step(120);
  const before=await l.snapshot(),chunks=[];const result=await l.renderStill({options:{width:320,height:180,samples:32,bounces:16},sink:{write:async b=>chunks.push(b),close:async()=>{},abort:async()=>{}}});const after=await l.snapshot();
  return {result,png:Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),unchanged:before.every((v,i)=>v===after[i]),errors:l.errors};
 });
 console.log('Shape still',all.result);assert.ok(all.png.length>10000);assert.ok(all.unchanged);assert.deepEqual(all.errors,[]);await writeFile('test-results/box3d-mixed-shapes-path.png',new Uint8Array(all.png));
 assert.deepEqual(errors,[]);console.log('Box3D shape checks passed.');
}finally{await browser.close();}
