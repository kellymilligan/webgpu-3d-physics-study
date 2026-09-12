import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1000,height:750}});const errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log(e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
await mkdir('test-results',{recursive:true});
try {
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 await page.evaluate(async()=>{
  const l=sphereLab;l.settings.paused=true;await l.step(1,0);
  const data=new Float32Array(12*12);for(let i=0;i<12;i++)data.set([(i%4-1.5)*3,1.3,((i/4)|0)*3-3,1.3,0,0,0,1],i*12);
  await l.world.reset({...l.settings,count:12,radius:1.3},data);
  window.captureRender=async function(options){
   const chunks=[],pixels=new Uint8Array(options.width*options.height*4);
   const result=await l.renderStill({options,sink:{write:async b=>chunks.push(b),close:async()=>{},abort:async()=>{}},onTile:t=>{for(let y=0;y<t.height;y++)pixels.set(t.pixels.subarray(y*t.width*4,(y+1)*t.width*4),((t.y+y)*options.width+t.x)*4);}});
   return {result,pixels,bytes:new Uint8Array(await new Blob(chunks).arrayBuffer())};
  };
 });
 const tiled=await page.evaluate(async()=>{
  const opts={width:117,height:83,samples:32,bounces:16};const a=await captureRender({...opts,tileSize:32});const b=await captureRender({...opts,tileSize:64});
  return {identical:a.pixels.every((v,i)=>v===b.pixels[i]),bytes:a.bytes.length,errors:sphereLab.errors};
 });console.log('Tile boundaries',tiled);assert.ok(tiled.identical);assert.deepEqual(tiled.errors,[]);
 const materials=await page.evaluate(async()=>{
   const s=sphereLab.settings,o={width:128,height:96,samples:64,bounces:24};
   s.materialMix=true;s.glassShare=1;s.chromeShare=0;s.glassIOR=1.5;const glass=(await captureRender(o)).pixels;
   s.glassIOR=2;const refracted=(await captureRender(o)).pixels;
   s.glassShare=0;s.chromeShare=1;const chrome=(await captureRender(o)).pixels;
   s.chromeShare=0;const matte=(await captureRender(o)).pixels;
   const changed=(a,b)=>a.reduce((sum,v,i)=>sum+(i%4<3&&Math.abs(v-b[i])>3?1:0),0);
   const res={refraction:changed(glass,refracted),chrome:changed(chrome,matte),glass:changed(glass,matte)};return res;
 });console.log('Material differences',materials);assert.ok(materials.refraction>50);assert.ok(materials.chrome>100);assert.ok(materials.glass>100);
 const high=await page.evaluate(async()=>{const result=await captureRender({width:12000,height:16,samples:1,bounces:4,tileSize:128});return {result:result.result,bytes:Array.from(result.bytes)};});
 await writeFile('test-results/12000-pixel-strip.png',new Uint8Array(high.bytes));console.log('High resolution',high.result);assert.equal(high.result.width,12000);
 const cancel=await page.evaluate(async()=>{
   const before=await sphereLab.snapshot();let closed=false,aborted=false;
   const job=sphereLab.renderStill({options:{width:800,height:600,samples:16384,bounces:32},sink:{write:async()=>{},close:async()=>{closed=true;},abort:async()=>{aborted=true;}}}).catch(e=>e.name);
   setTimeout(()=>sphereLab.cancelRender(),350);const reason=await job;const after=await sphereLab.snapshot();
   return {reason,closed,aborted,busy:sphereLab.exportInfo.busy,unchanged:before.every((v,i)=>v===after[i])};
 });console.log('Cancellation',cancel);assert.equal(cancel.reason,'AbortError');assert.ok(cancel.aborted&&!cancel.closed&&!cancel.busy&&cancel.unchanged);
 const failure=await page.evaluate(async()=>{
   let aborted=false;const reason=await sphereLab.renderStill({options:{width:16,height:16,samples:1,bounces:4},sink:{write:async()=>{throw new Error('Disk full test');},close:async()=>{},abort:async()=>{aborted=true;}}}).catch(e=>e.message);
   return {reason,aborted,busy:sphereLab.exportInfo.busy};
 });console.log('Write failure',failure);assert.equal(failure.reason,'Disk full test');assert.ok(failure.aborted&&!failure.busy);
 // Real fallback download and metadata, without writing to a user's chosen file.
 await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
 const downloadPromise=page.waitForEvent('download');
 await page.evaluate(()=>sphereLab.renderStill({save:true,options:{width:32,height:24,samples:2,bounces:4}}));
 const download=await downloadPromise;await download.saveAs('test-results/downloaded-still.png');
 const file=await readFile('test-results/downloaded-still.png');assert.equal(file.readUInt32BE(16),32);assert.equal(file.readUInt32BE(20),24);assert.equal(file[24],16);
 console.log('PNG download',download.suggestedFilename());
 for(const count of [1000000,2000000]){
  const stress=await page.evaluate(async count=>{
   const l=sphereLab;Object.assign(l.settings,{count,materialMix:true,glassShare:.3,chromeShare:.3,paused:true});l.fitRadius();await l.reset();
   const before=await l.snapshot(128);const r=await captureRender({width:64,height:48,samples:2,bounces:12});const after=await l.snapshot(128);
   return {...r.result,unchanged:before.every((v,i)=>v===after[i]),errors:l.errors};
  },count);console.log('Scale',stress);assert.equal(stress.count,count);assert.ok(stress.unchanged);assert.deepEqual(stress.errors,[]);
 }
 assert.deepEqual(errors,[]);console.log('Export workflow checks passed.');
}finally{await browser.close();}
