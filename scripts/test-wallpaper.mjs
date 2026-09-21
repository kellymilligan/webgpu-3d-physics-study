import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
await mkdir('test-results',{recursive:true});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 assert.equal(await page.evaluate(()=>sphereLab.settings.color),5);
 const selector=page.locator('select').filter({has:page.locator('option',{hasText:'5K Studio Display'})});
 await selector.selectOption({label:'Custom print'});assert.ok(await page.locator('#render-guide').isHidden());
 await selector.selectOption({label:'5K Studio Display'});assert.ok(await page.locator('#render-guide').isVisible());
 await page.setViewportSize({width:700,height:1000});
 const frame=await page.locator('#render-guide').boundingBox();assert.ok(Math.abs(frame.width/frame.height-16/9)<.002);
 assert.equal(await page.evaluate(()=>sphereLab.exportInfo.resolution),'5,120 × 2,880');await page.setViewportSize({width:1200,height:900});
 const materials=await page.evaluate(async()=>{
  const l=sphereLab;l.settings.paused=true;await l.step(1,0);const d=l.world.device;
  const code=(await import('/src/shaders/materials.wgsl?raw')).default;
  const module=d.createShaderModule({code:code+`@group(0) @binding(0) var<storage,read_write> out:array<vec4f>;@compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) id:vec3u){if(id.x>=10000u){return;}out[id.x]=vec4f(paletteColor(id.x,4.),f32(materialKind(id.x,65537.)));}`});
  const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'probe'}});
  const result=d.createBuffer({size:160000,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});const read=d.createBuffer({size:160000,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:result}}]});
  const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(157);pass.end();encoder.copyBufferToBuffer(result,0,read,0,160000);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(read.getMappedRange());const counts={},first={};let blueOrViolet=0,dark=0,green=0;
  for(let i=0;i<10000;i++){const kind=values[i*4+3];counts[kind]=(counts[kind]??0)+1;first[kind]??=i;if(values[i*4+2]>Math.max(values[i*4],values[i*4+1])+1e-6)blueOrViolet++;if(kind===8){if(Math.max(...values.subarray(i*4,i*4+3))<.03)dark++;else green++;}}
  window.materialIDs=first;read.unmap();result.destroy();read.destroy();return {counts,first,blueOrViolet,dark,green};
 });console.log('GPU material mix',materials);assert.ok(materials.counts[4]>100&&materials.counts[4]<300);assert.equal(materials.blueOrViolet,0);assert.ok(materials.dark>6000&&materials.dark<6600);assert.ok(materials.green>1250&&materials.green<1750);const glass=[3,5,6,7].reduce((sum,k)=>sum+materials.counts[k],0);assert.ok(glass>1850&&glass<2150);for(const kind of [3,5,6,7])assert.ok(materials.counts[kind]>350);
 const transport=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;const count=Math.max(64,...Object.values(materialIDs).map(id=>id+1));const state=new Float32Array(count*12);
  const resetState=()=>{for(let i=0;i<count;i++)state.set([1000+i*3,1000,1000,1,0,0,0,1],i*12);};
  Object.assign(s,{color:4,lightIntensity:0,ambientStrength:0,glowStrength:4});
  resetState();state.set([0,2,0,1],materialIDs[4]*12);state.set([2,1,0,1],materialIDs[8]*12);await l.world.reset({...s,count},state);
  async function render(){const pixels=new Uint8Array(240*180*4);await l.renderStill({options:{width:240,height:180,samples:256,bounces:16},sink:{write:async()=>{},close:async()=>{},abort:async()=>{}},onTile:t=>{for(let y=0;y<t.height;y++)pixels.set(t.pixels.subarray(y*t.width*4,(y+1)*t.width*4),((t.y+y)*240+t.x)*4);}});return pixels;}
  const lit=await render();s.glowStrength=0;const dark=await render();let litPixels=0,darkPixels=0,bouncedPixels=0;
  const camera=l.cameraData;const mul=(offset,p)=>[0,1,2,3].map(row=>p.reduce((sum,v,k)=>sum+v*camera[offset+k*4+row],0));
  const view=mul(0,[0,2,0,1]),clip=mul(16,view),cx=(clip[0]/clip[3]*.5+.5)*240,cy=(.5-clip[1]/clip[3]*.5)*180;
  const bound=Math.ceil(90*camera[21]/(-view[2]-1)*1.3)+2;
  for(let i=0;i<lit.length;i+=4){if(lit[i]+lit[i+1]+lit[i+2]>24){litPixels++;if(Math.abs((i/4)%240-cx)>bound||Math.abs(Math.floor(i/4/240)-cy)>bound)bouncedPixels++;}if(dark[i]+dark[i+1]+dark[i+2]>24)darkPixels++;}
  // Exclude conservative projected emitter bounds to measure actual bounced
  // illumination on the floor/receiver, rather than its visible emitting surface.
  resetState();state.set([0,2,0,2],materialIDs[7]*12);await l.world.reset({...s,count},state);Object.assign(s,{ambientStrength:.5,lightIntensity:3.2,frosting:0});
  const clear=await render();s.frosting=.8;const frosted=await render();let changed=0;for(let i=0;i<clear.length;i+=4)if(Math.abs(clear[i]-frosted[i])>3||Math.abs(clear[i+1]-frosted[i+1])>3||Math.abs(clear[i+2]-frosted[i+2])>3)changed++;
  return {litPixels,darkPixels,bouncedPixels,frostChanged:changed,errors:l.errors};
 });console.log('Light transport',transport);assert.ok(transport.bouncedPixels>100);assert.equal(transport.darkPixels,0);assert.ok(transport.frostChanged>150);assert.deepEqual(transport.errors,[]);
 // Exercise the preset itself: dimensions are not supplied by this call.
 const full=await page.evaluate(async()=>{
  const l=sphereLab;Object.assign(l.settings,{count:10000,glowStrength:4,frosting:.65,paused:true});l.fitRadius();await l.reset();await l.step(240);
  l.exportOptions.preset='studio5k';const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('forest-glow-5k-test.png',{create:true});const sink=await handle.createWritable();
  const before=await l.snapshot();const result=await l.renderStill({options:{samples:2,bounces:12},sink});const after=await l.snapshot();const file=await handle.getFile(),header=new DataView(await file.slice(0,33).arrayBuffer());
  const summary={...result,pngWidth:header.getUint32(16),pngHeight:header.getUint32(20),bitDepth:header.getUint8(24),bytes:file.size,unchanged:before.every((v,i)=>v===after[i]),errors:l.errors};await root.removeEntry('forest-glow-5k-test.png');return summary;
 });console.log('5K export',full);assert.equal(full.pngWidth,5120);assert.equal(full.pngHeight,2880);assert.equal(full.bitDepth,16);assert.ok(full.unchanged);assert.deepEqual(full.errors,[]);
 await page.screenshot({path:'test-results/forest-glow-5k-preview.png'});
 await page.getByRole('button',{name:'Material',exact:true}).click();
 const themes=page.locator('select').filter({has:page.locator('option',{hasText:'Forest Glow'})});
 const input=label=>page.locator('.tp-lblv').filter({has:page.locator('.tp-lblv_l',{hasText:label})}).locator('input');
 await themes.selectOption({label:'Sprinkles'});assert.ok(await input('Glass share').isEnabled());assert.ok(await input('Frosting range').isDisabled());
 await themes.selectOption({label:'Forest Glow'});assert.ok(await input('Glass share').isDisabled());assert.ok(await input('Frosting range').isEnabled());
 assert.deepEqual(errors,[]);
 await writeFile('test-results/wallpaper-results.json',JSON.stringify({materials,transport,full},null,2));
}finally{await browser.close();}
