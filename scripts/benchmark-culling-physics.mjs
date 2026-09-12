import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const results=[];
try {
 await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count>0);
 for(const count of [1000000,2000000]){
  const result=await page.evaluate(async count=>{
   const l=sphereLab,s=l.settings;Object.assign(s,{count,variation:0,paused:true,culling:true});l.fitRadius();await l.reset();
   const data=await l.snapshot();let lo=Infinity;for(let i=0;i<data.length;i+=12)lo=Math.min(lo,data[i+1]-data[i+3]);for(let i=0;i<data.length;i+=12)data[i+1]-=lo;
   l.world.device.queue.writeBuffer(l.world.buffers[l.world.index],0,data);await l.step(160);
   const state=await l.snapshot();
   async function measure(culling){
    s.culling=culling;l.world.device.queue.writeBuffer(l.world.buffers[l.world.index],0,state);await l.step(8,0);
    const samples=[];const start=performance.now();
    for(let n=0;n<24;n++){await l.step(1);samples.push({physics:l.world.physicsMs,render:l.world.renderMs,cull:l.world.visibilityMs,total:l.world.gpuMs});}
    const mean=key=>samples.reduce((v,s)=>v+s[key],0)/samples.length;
    return {frameMs:(performance.now()-start)/24,physicsMs:mean('physics'),renderMs:mean('render'),cullMs:mean('cull'),gpuMs:mean('total'),drawn:l.world.visibleCount};
   }
   return {count,off:await measure(false),on:await measure(true),errors:l.errors};
  },count);
  console.log(JSON.stringify(result));results.push(result);for(const mode of ['off','on']){assert.ok(result[mode].physicsMs>=0&&result[mode].physicsMs<result[mode].gpuMs);assert.ok(result[mode].renderMs>=0);}assert.deepEqual(result.errors,[]);
 }
}finally{await writeFile('test-results/culling-physics-results.json',JSON.stringify(results,null,2));await browser.close();}
