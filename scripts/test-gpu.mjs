import {chromium} from 'playwright';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const candidates=[process.env.CHROME_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const executablePath=candidates.find(existsSync);
const browser=await chromium.launch({headless:true,executablePath,args:['--enable-unsafe-webgpu']});
await mkdir('test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('Browser error:',m.text());}});
const results=[];
const timeout=setTimeout(async()=>{console.log('Timed out',await page.evaluate(()=>({stats:sphereLab.stats,count:sphereLab.world.count,errors:sphereLab.errors})).catch(()=>null));await browser.close();},60000);
try {
  await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');
  await page.waitForFunction(()=>window.sphereLab?.world?.count>0,{timeout:30000});
  await page.evaluate(()=>{sphereLab.settings.paused=true;});
  async function run(label,fn,arg){const result=await page.evaluate(fn,arg);results.push({label,...result});console.log(label,JSON.stringify(result));return result;}
  const settle=await run('10k settling and containment',async()=>{
    const lab=sphereLab,s=lab.settings;Object.assign(s,{count:10000,variation:0,gravity:9.81,paused:true});lab.fitRadius();await lab.reset();
    await lab.step(480);const data=await lab.snapshot();let escaped=0,nonfinite=0,meanY=0,meanSpeed=0,maxSpeed=0;
    for(let i=0;i<data.length;i+=12){const [x,y,z,r,vx,vy,vz]=data.subarray(i,i+7);if(!Number.isFinite(x+y+z+r+vx+vy+vz))nonfinite++;
      if(Math.abs(x)+r>s.width/2+.001||Math.abs(z)+r>s.depth/2+.001||y-r<-.001||y+r>s.height+.001)escaped++;
      meanY+=y;const speed=Math.hypot(vx,vy,vz);meanSpeed+=speed;maxSpeed=Math.max(maxSpeed,speed);
    }return {escaped,nonfinite,meanY:meanY/s.count,meanSpeed:meanSpeed/s.count,maxSpeed,gpuMs:lab.world.gpuMs};
  });
  assert.equal(settle.escaped,0);assert.equal(settle.nonfinite,0);assert.ok(settle.meanY<7);assert.ok(settle.meanSpeed<1,'stack should settle');
  await page.screenshot({path:'test-results/settled.png'});
  // Drive actual pointer events and compare particle positions before/after stirring.
  const before=await page.evaluate(async()=>Array.from(await sphereLab.snapshot()));
  await page.mouse.move(590,650);await page.mouse.down();await page.mouse.move(850,680,{steps:20});
  await page.evaluate(()=>sphereLab.step(30));
  await page.screenshot({path:'test-results/cursor.png'});await page.mouse.up();
  const after=await page.evaluate(async()=>Array.from(await sphereLab.snapshot()));
  let moved=0;for(let i=0;i<before.length;i+=12)if(Math.hypot(after[i]-before[i],after[i+1]-before[i+1],after[i+2]-before[i+2])>.05)moved++;
  console.log('Cursor moved',moved,'spheres');assert.ok(moved>10);
  for(const count of [100000,200000,500000,1000000,2000000]){
    const result=await run(`${count} spheres`,async count=>{
      const lab=sphereLab;Object.assign(lab.settings,{count,variation:0,paused:true});lab.fitRadius();const t=performance.now();await lab.reset();const initializationMs=performance.now()-t;
      const start=performance.now();await lab.step(8);const elapsed=performance.now()-start;
      const data=await lab.snapshot(10000);let finite=true;for(const n of data)if(!Number.isFinite(n))finite=false;
      return {actual:lab.world.count,initializationMs,frameMs:elapsed/8,gpuMs:lab.world.gpuMs,memoryMB:lab.world.memoryMB,finite,errors:lab.errors};
    },count);
    assert.equal(result.actual,count);assert.ok(result.finite);assert.deepEqual(result.errors,[]);
  }
  const variable=await run('5x variable radius',async()=>{
    const lab=sphereLab;Object.assign(lab.settings,{count:10000,variation:1,paused:true});lab.fitRadius();await lab.reset();await lab.step(240);
    const data=await lab.snapshot();let min=Infinity,max=0,escaped=0;const s=lab.settings;
    for(let i=0;i<data.length;i+=12){const [x,y,z,r]=data.subarray(i,i+4);min=Math.min(min,r);max=Math.max(max,r);if(Math.abs(x)+r>s.width/2+.001||Math.abs(z)+r>s.depth/2+.001||y-r<-.001||y+r>s.height+.001)escaped++;}
    return {ratio:max/min,escaped};
  });
  assert.ok(variable.ratio>4.98);assert.equal(variable.escaped,0);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png'});
  assert.deepEqual(errors,[]);console.log('All GPU checks passed.');
} finally {clearTimeout(timeout);await writeFile('test-results/gpu-results.json',JSON.stringify({results,errors},null,2));await browser.close();}
