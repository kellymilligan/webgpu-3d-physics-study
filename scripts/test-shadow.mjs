import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
 await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 const result=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;s.paused=true;await l.step(1,0);
  // A single analytic receiver isolates self-shadowing from real inter-body shadows.
  const seed=new Float32Array([0,2,0,2,0,0,0,1,0,0,0,0]);
  await l.world.reset({...s,count:1,radius:2,variation:0},seed);
  const cases=[];
  for(const resolution of [1024,2048,4096])for(const direction of [-60,60]){
   Object.assign(s,{shadowResolution:resolution,lightAzimuth:direction,debugLighting:3});await l.step(2,0);const normals=await l.capture();
   s.debugLighting=2;await l.step(2,0);const shadows=await l.capture();
   let spherePixels=0,acne=0,floorShadow=0,cx=0;
   // Floor/background masks are symmetric in red and blue, so both
   // preferred canvas formats (RGBA and BGRA) use the same classification.
   for(let i=0;i<shadows.length;i+=4){
    const floor=Math.abs(normals[i]-128)<=1&&normals[i+1]===255&&Math.abs(normals[i+2]-128)<=1;
    const background=normals[i]<30&&normals[i+1]<30&&normals[i+2]<30;
    if(!floor&&!background){spherePixels++;if(shadows[i]<245)acne++;}
    if(floor&&shadows[i]<128){floorShadow++;cx+=(i/4)%1440;}
   }
   cases.push({resolution,direction,spherePixels,acne,floorShadow,shadowX:cx/floorShadow});
  }
  return {cases,errors:l.errors};
 });
 console.log(JSON.stringify(result,null,2));
 for(const c of result.cases){assert.ok(c.spherePixels>1000);assert.ok(c.acne/c.spherePixels<.01,'isolated sphere should not shadow itself');assert.ok(c.floorShadow>100,'sphere must cast a floor shadow');}
 for(let i=0;i<result.cases.length;i+=2)assert.ok(Math.abs(result.cases[i].shadowX-result.cases[i+1].shadowX)>40,'shadow must move with the light');
 assert.deepEqual(result.errors,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:'test-results/single-shadow.png'});console.log('Shadow geometry checks passed.');
}finally{await browser.close();}
