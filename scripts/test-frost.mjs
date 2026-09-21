import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1000,height:750}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 assert.equal(await page.evaluate(()=>sphereLab.settings.color),5);
 const result=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;s.paused=true;await l.step(1,0);const d=l.world.device;
  const code=(await import('/src/shaders/materials.wgsl?raw')).default;
  const {packMaterials}=await import('/src/export/path-tracer.js');
  const module=await l.world.module(code+`@group(0) @binding(0) var<storage,read_write> out:array<vec4f>;@compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) id:vec3u){if(id.x>=10000u){return;}out[id.x]=vec4f(paletteColor(id.x,5.),f32(materialKind(id.x,${packMaterials(s)}.)));}`,'Frost material probe');
  const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'probe'}});
  const output=d.createBuffer({size:160000,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:160000,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output}}]});
  const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(157);pass.end();encoder.copyBufferToBuffer(output,0,read,0,160000);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(read.getMappedRange()),counts={};let tintedGlass=0;
  for(let i=0;i<10000;i++){const k=values[i*4+3];counts[k]=(counts[k]??0)+1;if(k!==4&&(values[i*4]!==values[i*4+1]||values[i*4]!==values[i*4+2]))tintedGlass++;}
  read.unmap();output.destroy();read.destroy();
  // Use a small isolated group to test the black environment independently of
  // sphere occlusion, and retain deterministic samples for image comparisons.
  const state=new Float32Array(100*12);for(let i=0;i<100;i++)state.set([(i%10-4.5)*1.4,.65,Math.floor(i/10)*1.4-6,.65,0,0,0,1],i*12);
  await l.world.reset({...s,count:100},state);await l.step(2,0);const before=await l.snapshot();const live=await l.capture();
  const options={width:160,height:120,samples:64,bounces:24};
  async function render(changes){Object.assign(s,changes);const pixels=new Uint8Array(160*120*4);await l.renderStill({options,sink:{write:async()=>{},close:async()=>{},abort:async()=>{}},onTile:t=>{for(let y=0;y<t.height;y++)pixels.set(t.pixels.subarray(y*t.width*4,(y+1)*t.width*4),((t.y+y)*160+t.x)*4);}});return pixels;}
  const frosted=await render({ambientStrength:0}),ambient=await render({ambientStrength:2}),clear=await render({frosting:0});
  const dark=await render({lightIntensity:0,glowStrength:0});
  const changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])))>3)n++;return n;};
  const after=await l.snapshot();let darkPixels=0;for(let i=0;i<dark.length;i+=4)if(dark[i]+dark[i+1]+dark[i+2]>0)darkPixels++;
  return {counts,tintedGlass,liveBackground:Array.from(live.slice(0,3)),tracedBackground:Array.from(frosted.slice(0,3)),frostDifference:changed(frosted,clear),ambientDifference:changed(frosted,ambient),darkPixels,unchanged:before.every((v,i)=>v===after[i]),errors:l.errors};
 });
 console.log(result);assert.deepEqual(Object.keys(result.counts).sort(),['4','5','6','7']);assert.ok(result.counts[4]>100&&result.counts[4]<300);for(const k of [5,6,7])assert.ok(result.counts[k]>3000&&result.counts[k]<3500);
 assert.equal(result.tintedGlass,0);assert.deepEqual(result.liveBackground,[0,0,0]);assert.deepEqual(result.tracedBackground,[0,0,0]);assert.ok(result.frostDifference>50);assert.equal(result.ambientDifference,0);assert.equal(result.darkPixels,0);assert.ok(result.unchanged);assert.deepEqual(result.errors,[]);
 await page.getByRole('button',{name:'Return to scene',exact:true}).click();await page.getByRole('button',{name:'Material',exact:true}).click();
 const themes=page.locator('select').filter({has:page.locator('option',{hasText:'Frost & Glow'})});
 const input=label=>page.locator('.tp-lblv').filter({has:page.locator('.tp-lblv_l',{hasText:label})}).locator('input');
 assert.ok(await input('Ambient').isDisabled());assert.ok(await input('Frosting range').isEnabled());assert.ok(await input('Glass share').isDisabled());
 await themes.selectOption({label:'Forest Glow'});assert.ok(await input('Ambient').isEnabled());
 await themes.selectOption({label:'Frost & Glow'});assert.ok(await input('Ambient').isDisabled());assert.deepEqual(errors,[]);
}finally{await browser.close();}
