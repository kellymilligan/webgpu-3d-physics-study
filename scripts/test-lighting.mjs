import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],results=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message);});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('GPU',m.text());}});
const timeout=setTimeout(()=>browser.close(),120000);
await mkdir('test-results',{recursive:true});
try {
 await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab,{timeout:30000});
 console.log('Startup',await page.evaluate(()=>({stats:sphereLab.stats,errors:sphereLab.errors})));assert.deepEqual(await page.evaluate(()=>sphereLab.errors),[]);
 await page.evaluate(async()=>{const l=sphereLab;Object.assign(l.settings,{paused:true,count:10000,variation:0,materialMix:false});l.fitRadius();await l.reset();await l.step(420);});
 await page.screenshot({path:'test-results/lighting-stack.png'});
 const effects=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;const baseline=await l.snapshot();
  async function pixels(changes){Object.assign(s,changes);await l.step(2,0);return l.capture();}
  function compare(a,b){let changed=0,difference=0,lightening=0;for(let i=0;i<a.length;i+=4){const x=a[i]+a[i+1]+a[i+2],y=b[i]+b[i+1]+b[i+2];if(Math.abs(x-y)>6)changed++;difference+=Math.abs(x-y);lightening+=y-x;}return {changed,meanDifference:difference/(a.length/4)/3,meanLightening:lightening/(a.length/4)/3};}
  const lit=await pixels({shadows:true,ao:true,debugLighting:0});
  const noAO=await pixels({ao:false});const noShadow=await pixels({ao:true,shadows:false});
  const rough=await pixels({shadows:true,roughness:.9});const metal=await pixels({roughness:.2,metallic:1});
  const aoOnly=await pixels({metallic:0,roughness:.38,debugLighting:1,ao:true});
  let gray=0,dark=0;for(let i=0;i<aoOnly.length;i+=4)if(aoOnly[i]===aoOnly[i+1]&&aoOnly[i+1]===aoOnly[i+2]){gray++;if(aoOnly[i]<235)dark++;}
  const after=await l.snapshot();s.debugLighting=0;
  return {ao:compare(lit,noAO),shadow:compare(lit,noShadow),roughness:compare(lit,rough),metal:compare(lit,metal),aoPixels:gray,occludedPixels:dark,physicsUnchanged:baseline.every((v,i)=>v===after[i]),errors:l.errors};
 });
 console.log('Effects',JSON.stringify(effects));results.push(effects);
 assert.ok(effects.ao.changed>1000);assert.ok(effects.ao.meanLightening>0);
 assert.ok(effects.shadow.changed>1000);assert.ok(effects.shadow.meanLightening>0);
 assert.ok(effects.roughness.changed>1000);assert.ok(effects.metal.changed>1000);assert.ok(effects.occludedPixels>1000);assert.ok(effects.physicsUnchanged);assert.deepEqual(effects.errors,[]);
 for(const [mode,name] of [[1,'ao'],[2,'shadows'],[3,'normals'],[0,'lit']]){
  await page.evaluate(async mode=>{sphereLab.settings.debugLighting=mode;await sphereLab.step(2,0);},mode);await page.screenshot({path:`test-results/lighting-${name}.png`});
 }
 for(const resolution of [1024,4096,2048])await page.evaluate(async resolution=>{sphereLab.settings.shadowResolution=resolution;await sphereLab.step(2,0);},resolution);
 await page.setViewportSize({width:391,height:845});await page.evaluate(()=>sphereLab.step(2,0));await page.screenshot({path:'test-results/lighting-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});
 // Camera-hidden spheres must still cast shadows: compare camera culling on/off.
 const culling=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;s.culling=false;await l.step(2,0);const a=await l.capture();s.culling=true;await l.step(3,0);const b=await l.capture();let changed=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>3)changed++;return {changed,pixels:a.length/4,errors:l.errors};
 });console.log('Culling equivalence',culling);assert.ok(culling.changed/culling.pixels<.0001);assert.deepEqual(culling.errors,[]);
 for(const count of [1000000,2000000]){
  const result=await page.evaluate(async count=>{
    const l=sphereLab,s=l.settings;Object.assign(s,{count,variation:0,paused:true});l.fitRadius();await l.reset();
    const data=await l.snapshot();let low=Infinity;for(let i=0;i<data.length;i+=12)low=Math.min(low,data[i+1]-data[i+3]);for(let i=0;i<data.length;i+=12)data[i+1]-=low;
    l.world.device.queue.writeBuffer(l.world.buffers[l.world.index],0,data);
    await l.step(6,0);const samples=[];for(let i=0;i<12;i++){await l.step(1,0);samples.push({total:l.world.gpuMs,shadow:l.world.shadowMs,ao:l.world.aoMs,lighting:l.world.lightingMs});}
    const mean=key=>samples.reduce((sum,v)=>sum+v[key],0)/samples.length;
    await l.step(4);return {count,renderMs:mean('total'),shadowMs:mean('shadow'),aoMs:mean('ao'),lightingMs:mean('lighting'),movingFrameMs:l.world.gpuMs,visible:l.world.visibleCount,errors:l.errors};
  },count);console.log('Benchmark',JSON.stringify(result));results.push(result);assert.deepEqual(result.errors,[]);assert.ok(result.shadowMs>=0&&result.aoMs>=0);assert.ok(await page.evaluate(()=>Math.abs(sphereLab.world.renderMs+sphereLab.world.visibilityMs+sphereLab.world.physicsMs-sphereLab.world.gpuMs)<.001),'frame timing must not double-count overlapping passes');await page.screenshot({path:`test-results/lighting-${count}.png`});
 }
 assert.deepEqual(errors,[]);console.log('Lighting checks passed.');
}finally{clearTimeout(timeout);await writeFile('test-results/lighting-results.json',JSON.stringify({results,errors},null,2));await browser.close();}
