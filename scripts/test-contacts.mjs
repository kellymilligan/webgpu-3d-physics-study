import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage();await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count>0);
try {
  const result=await page.evaluate(async()=>{
    const lab=sphereLab,s=lab.settings;s.paused=true;await lab.step(1);
    async function pair(restitution,small=false){
      Object.assign(s,{count:2,radius:.25,variation:1,gravity:0,damping:0,mass:1,restitution,friction:0,substeps:2,iterations:2});
      const r=small?.25:.5;
      const data=new Float32Array([-0.5,5,0,.5, 1,0,0,.125, 0,0,0,0, r,5,0,r, small?0:-1,0,0,1, 0,0,0,0]);
      await lab.world.reset(s,data);await lab.step(2);const after=await lab.snapshot();
      return {left:after[4],right:after[16],momentum:after[4]*8+after[16]*(small?1:8)};
    }
    async function floor(friction){
      Object.assign(s,{count:1,radius:.5,variation:0,gravity:9.81,damping:0,mass:1,restitution:0,friction,substeps:2,iterations:2});
      await lab.world.reset(s,new Float32Array([0,.5,0,.5,4,-1,0,1,0,0,0,0]));await lab.step(12);const after=await lab.snapshot();return {vx:after[4],spin:after[10],height:after[1]};
    }
    return {inelastic:await pair(0),elastic:await pair(1),unequal:await pair(.5,true),smooth:await floor(0),rough:await floor(1),errors:lab.errors};
  });
  console.log(JSON.stringify(result,null,2));
  assert.ok(result.elastic.right>result.inelastic.right+.2);
  assert.ok(Math.abs(result.unequal.momentum-8)<.01);
  assert.ok(result.rough.vx<result.smooth.vx-.1);assert.ok(Math.abs(result.rough.spin)>.1);
  assert.deepEqual(result.errors,[]);console.log('Restitution, relative mass, friction and spin checks passed.');
}finally{await browser.close();}
