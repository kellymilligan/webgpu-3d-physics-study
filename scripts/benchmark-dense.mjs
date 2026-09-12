import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count>0);
const results=[];
for(const count of [1000000,2000000]){
  const result=await page.evaluate(async count=>{
    const l=sphereLab,s=l.settings;Object.assign(s,{count,paused:true,variation:0});l.fitRadius();await l.reset();
    // Move the conservative seed lattice down to the floor so the test starts dense.
    const data=await l.snapshot();let low=Infinity;for(let i=0;i<data.length;i+=12)low=Math.min(low,data[i+1]-data[i+3]);
    for(let i=0;i<data.length;i+=12)data[i+1]-=low;
    l.world.device.queue.writeBuffer(l.world.buffers[l.world.index],0,data);
    await l.step(240);
    const start=performance.now();await l.step(30);const frameMs=(performance.now()-start)/30;
    const settled=await l.snapshot();let escaped=0,nonfinite=0,meanSpeed=0,maxSpeed=0;
    for(let i=0;i<settled.length;i+=12){const[x,y,z,r,vx,vy,vz]=settled.subarray(i,i+7);if(!Number.isFinite(x+y+z+r+vx+vy+vz))nonfinite++;if(Math.abs(x)+r>s.width/2+.001||Math.abs(z)+r>s.depth/2+.001||y-r<-.001||y+r>s.height+.001)escaped++;const speed=Math.hypot(vx,vy,vz);meanSpeed+=speed;maxSpeed=Math.max(maxSpeed,speed);}
    return {count,frameMs,gpuMs:l.world.gpuMs,escaped,nonfinite,meanSpeed:meanSpeed/count,maxSpeed,errors:l.errors,adapter:{vendor:l.world.adapter.info.vendor,architecture:l.world.adapter.info.architecture,device:l.world.adapter.info.device,description:l.world.adapter.info.description}};
  },count);
  results.push(result);console.log(JSON.stringify(result));await page.screenshot({path:`test-results/dense-${count}.png`});
}
await writeFile('test-results/dense-results.json',JSON.stringify(results,null,2));await browser.close();
