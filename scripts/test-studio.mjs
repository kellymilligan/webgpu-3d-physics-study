import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1000,height:750}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
await mkdir('test-results',{recursive:true});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab);
 const setup=page.locator('select').filter({has:page.locator('option',{hasText:'Studio strips'})});
 const control=label=>page.locator('.tp-lblv').filter({has:page.locator('.tp-lblv_l',{hasText:label})});
 assert.equal(await page.evaluate(()=>sphereLab.settings.lightRig),'studio');assert.ok(await control('Strip width').isVisible());
 await setup.selectOption({label:'Single softbox'});assert.ok(await control('Strip width').isHidden());assert.ok(await control('Softbox diameter').isVisible());
 await setup.selectOption({label:'Studio strips'});assert.ok(await control('Softbox diameter').isHidden());
 const result=await page.evaluate(async()=>{
  const l=sphereLab,s=l.settings;s.paused=true;await l.step(1,0);
  // A large polished receiver makes the shape of the reflected rig visible.
  Object.assign(s,{color:2,materialMix:false,metallic:1,roughness:.06,ambientStrength:0,glowStrength:0});
  await l.world.reset({...s,count:1},new Float32Array([0,4,0,4,0,0,0,1,0,0,0,0]));
  const before=await l.snapshot();
  const changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])))>5)n++;return n;};
  async function live(changes){Object.assign(s,changes);await l.step(2,0);return l.capture();}
  const liveStudio=await live({lightRig:'studio'}),liveWide=await live({stripWidth:10}),liveRotated=await live({stripWidth:4,lightAzimuth:65}),liveSingle=await live({lightAzimuth:-35,lightRig:'single'});
  const size={width:320,height:240,samples:256,bounces:12};
  async function still(changes){Object.assign(s,changes);const pixels=new Uint8Array(size.width*size.height*4);await l.renderStill({options:size,sink:{write:async()=>{},close:async()=>{},abort:async()=>{}},onTile:t=>{for(let y=0;y<t.height;y++)pixels.set(t.pixels.subarray(y*t.width*4,(y+1)*t.width*4),((t.y+y)*size.width+t.x)*4);}});return pixels;}
  const studio=await still({lightRig:'studio'}),wide=await still({stripWidth:10}),rotated=await still({stripWidth:4,lightAzimuth:65}),single=await still({lightRig:'single',lightAzimuth:-35});
  const dark=await still({lightRig:'studio',lightIntensity:0});
  let darkPixels=0;for(let i=0;i<dark.length;i+=4)if(dark[i]+dark[i+1]+dark[i+2]>0)darkPixels++;
  const after=await l.snapshot();
  Object.assign(s,{lightIntensity:3.2});await l.step(2,0);
  window.studioComparison={studio:Array.from(studio),single:Array.from(single),width:size.width,height:size.height};
  return {live:{width:changed(liveStudio,liveWide),rotation:changed(liveStudio,liveRotated),setup:changed(liveStudio,liveSingle)},traced:{width:changed(studio,wide),rotation:changed(studio,rotated),setup:changed(studio,single)},darkPixels,unchanged:before.every((v,i)=>v===after[i]),errors:l.errors};
 });
 console.log(result);for(const mode of [result.live,result.traced])for(const pixels of Object.values(mode))assert.ok(pixels>100);assert.equal(result.darkPixels,0);assert.ok(result.unchanged);assert.deepEqual(result.errors,[]);assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'Return to scene',exact:true}).click();
 await page.evaluate(()=>sphereLab.step(2,0));
 await page.screenshot({path:'test-results/studio-polished-live.png'});
 const comparison=await page.evaluate(()=>{const c=document.createElement('canvas'),v=studioComparison;c.width=v.width*2;c.height=v.height;const context=c.getContext('2d');context.putImageData(new ImageData(new Uint8ClampedArray(v.single),v.width,v.height),0,0);context.putImageData(new ImageData(new Uint8ClampedArray(v.studio),v.width,v.height),v.width,0);return c.toDataURL('image/png').split(',')[1];});
 await writeFile('test-results/studio-comparison.png',Buffer.from(comparison,'base64'));
 await writeFile('test-results/studio-results.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
