import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('GPU',m.text());}});
await mkdir('test-results',{recursive:true});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 await page.evaluate(async()=>{Object.assign(sphereLab.settings,{count:10000,paused:true});sphereLab.fitRadius();await sphereLab.reset();await sphereLab.step(360);});
 await page.screenshot({path:'test-results/mixed-realtime.png'});
 const result=await page.evaluate(async quality=>{
   const l=sphereLab;const before=await l.snapshot();const chunks=[];
   const result=await l.renderStill({options:quality,sink:{write:async b=>chunks.push(b),close:async()=>{},abort:async()=>{} }});
   const after=await l.snapshot();const blob=new Blob(chunks,{type:'image/png'});const bytes=new Uint8Array(await blob.arrayBuffer());
   return {result,unchanged:before.every((v,i)=>v===after[i]),png:Array.from(bytes),errors:l.errors};
 },{width:Number(process.env.PT_WIDTH??400),height:Number(process.env.PT_HEIGHT??300),samples:Number(process.env.PT_SAMPLES??64),bounces:24});
 console.log({result:result.result,unchanged:result.unchanged,pngBytes:result.png.length,errors:result.errors});
 await writeFile('test-results/path-traced.png',new Uint8Array(result.png));await page.screenshot({path:'test-results/path-traced-ui.png'});
 assert.ok(result.unchanged);assert.deepEqual(result.errors,[]);assert.deepEqual(errors,[]);assert.ok(result.png.length>10000);
}finally{await browser.close();}
