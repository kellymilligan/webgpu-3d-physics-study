import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1200,height:900}});page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 await page.evaluate(async()=>{Object.assign(sphereLab.settings,{count:10000,paused:true});sphereLab.fitRadius();await sphereLab.reset();await sphereLab.step(240);});
 const result=await page.evaluate(async()=>{
  const root=await navigator.storage.getDirectory();const handle=await root.getFileHandle('full-print-test.png',{create:true});const sink=await handle.createWritable();
  const result=await sphereLab.renderStill({options:{width:12000,height:9000,samples:1,bounces:8},sink});
  const file=await handle.getFile(),header=new DataView(await file.slice(0,33).arrayBuffer());
  const summary={...result,fileBytes:file.size,pngWidth:header.getUint32(16),pngHeight:header.getUint32(20),depth:header.getUint8(24),errors:sphereLab.errors};await root.removeEntry('full-print-test.png');return summary;
 });console.log(result);assert.equal(result.pngWidth,12000);assert.equal(result.pngHeight,9000);assert.equal(result.depth,16);assert.deepEqual(result.errors,[]);
}finally{await browser.close();}
