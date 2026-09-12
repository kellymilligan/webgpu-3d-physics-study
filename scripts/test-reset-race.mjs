import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage();
const timeout=setTimeout(()=>browser.close(),30000);
try{
 await page.goto('http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count>0);
 const result=await page.evaluate(async()=>{
  const l=sphereLab;l.settings.paused=true;
  l.settings.count=500000;l.fitRadius();const older=l.reset();
  l.settings.count=200000;l.fitRadius();const newer=l.reset();
  await Promise.all([older,newer]);await l.step(1,0);
  return {count:l.world.count,actual:l.stats.actual,errors:l.errors};
 });
 assert.equal(result.count,200000);assert.equal(result.actual,'200,000');assert.deepEqual(result.errors,[]);
 await page.locator('select').first().selectOption({label:'500k'});
 await page.locator('select').first().selectOption({label:'10k'});
 await page.waitForFunction(()=>sphereLab.world.count===10000);
 await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>sphereLab.world.count),10000);
 assert.deepEqual(await page.evaluate(()=>sphereLab.errors),[]);console.log('Concurrent reset promises resolve, latest count wins, and rapid GUI changes complete.');
}finally{clearTimeout(timeout);await browser.close();}
