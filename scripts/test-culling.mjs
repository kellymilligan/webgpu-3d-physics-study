import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
await mkdir('test-results',{recursive:true});
try {
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');
 await page.waitForFunction(()=>window.sphereLab,{timeout:30000});
 console.log('Startup',await page.evaluate(()=>({errors:sphereLab.errors,stats:sphereLab.stats})));
 assert.deepEqual(await page.evaluate(()=>sphereLab.errors),[]);
 await page.evaluate(()=>{sphereLab.settings.paused=true;});
 async function compare(label){
   const result=await page.evaluate(async()=>{
     const lab=sphereLab,s=lab.settings;s.paused=true;
     s.culling=false;await lab.step(2,0);const a=await lab.capture();
     s.culling=true;const b=await lab.capture();let changed=0,max=0,total=0;
     for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(d>3)changed++;max=Math.max(max,d);total+=d;}
     return {nonblank:a.some((v,i)=>i%4!==3&&v>40)&&b.some((v,i)=>i%4!==3&&v>40),changedPixels:changed,pixels:a.length/4,maxDifference:max,meanDifference:total/(a.length/4),visible:lab.world.visibleCount,count:lab.world.count,errors:lab.errors};
   });
   console.log(label,result);results.push({label,...result});assert.deepEqual(result.errors,[]);assert.ok(result.nonblank);assert.ok(result.changedPixels/result.pixels<.00001,`${label}: image changed`);return result;
 }
 const first=await compare('initial 100k');assert.ok(first.visible<first.count*.7);
 const unchanged=await page.evaluate(async()=>{const l=sphereLab;const a=await l.snapshot();l.settings.culling=false;await l.step(2,0);l.settings.culling=true;await l.step(3,0);const b=await l.snapshot();return a.every((v,i)=>v===b[i]);});
 assert.ok(unchanged,'culling must not change physics buffers');console.log('Physics buffers unchanged by culling.');
 await page.mouse.move(500,400);await page.mouse.down({button:'right'});await page.mouse.move(980,530,{steps:6});await page.mouse.up({button:'right'});await compare('camera orbit');
 await page.mouse.wheel(0,-1000);await compare('zoom');
 await page.mouse.move(700,550);await page.mouse.down();await page.mouse.move(580,500,{steps:8});await page.evaluate(()=>sphereLab.step(30));await compare('stirred');await page.mouse.up();
 await page.setViewportSize({width:391,height:845});await compare('odd-sized portrait');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(async()=>{Object.assign(sphereLab.settings,{count:10000,variation:1});sphereLab.fitRadius();await sphereLab.reset();});await compare('variable radii reset');
 for(const count of [1000000,2000000]) {
  const result=await page.evaluate(async count=>{
    const lab=sphereLab,s=lab.settings;Object.assign(s,{count,variation:0,paused:true});lab.fitRadius();await lab.reset();
    const state=await lab.snapshot();let low=Infinity;for(let i=0;i<state.length;i+=12)low=Math.min(low,state[i+1]-state[i+3]);for(let i=0;i<state.length;i+=12)state[i+1]-=low;
    lab.world.device.queue.writeBuffer(lab.world.buffers[lab.world.index],0,state);
    async function measure(culling){s.culling=culling;await lab.step(8,0);const samples=[];for(let i=0;i<30;i++){await lab.step(1,0);samples.push({render:lab.world.renderMs,cull:lab.world.visibilityMs,total:lab.world.gpuMs});}const mean=key=>samples.reduce((n,s)=>n+s[key],0)/samples.length;return {renderMs:mean('render'),cullMs:mean('cull'),totalMs:mean('total'),drawn:lab.world.visibleCount};}
    return {count,off:await measure(false),on:await measure(true),errors:lab.errors};
  },count);
  results.push(result);console.log('Benchmark',JSON.stringify(result));assert.deepEqual(result.errors,[]);assert.ok(result.on.drawn<count*.5);
  await compare(`${count} dense image`);await page.screenshot({path:`test-results/culling-${count}.png`});
 }
 assert.deepEqual(errors,[]);console.log('Culling validation passed.');
}finally{await writeFile('test-results/culling-results.json',JSON.stringify({results,errors},null,2));await browser.close();}
