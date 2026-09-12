import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
try {
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await page.waitForFunction(()=>window.sphereLab?.world?.count===100000);
 await page.locator('select').first().selectOption({label:'10k'});await page.waitForFunction(()=>sphereLab.world.count===10000);
 await page.getByRole('button',{name:'Container',exact:true}).click();
 await page.getByRole('button',{name:'Cursor',exact:true}).click();
 await page.getByRole('button',{name:'Performance',exact:true}).click();
 await page.waitForTimeout(3500);
 await page.mouse.move(640,560);await page.mouse.down();await page.mouse.move(730,580,{steps:15});
 await page.waitForTimeout(200);console.log('Cursor state',await page.evaluate(()=>sphereLab.cursor));assert.equal(await page.evaluate(()=>sphereLab.cursor.active),true);await page.screenshot({path:'test-results/final-cursor.png'});await page.mouse.up();
 await page.evaluate(()=>sphereLab.setCursor([0,12,0]));await page.waitForTimeout(100);await page.screenshot({path:'test-results/cursor-isolated.png'});await page.evaluate(()=>sphereLab.setCursor([0,12,0],false));
 const before=await page.screenshot();await page.mouse.move(500,400);await page.mouse.down({button:'right'});await page.mouse.move(610,430,{steps:10});await page.mouse.up({button:'right'});const after=await page.screenshot();assert.notDeepEqual(before,after);
 await page.locator('canvas').focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>sphereLab.settings.paused),true);
 await page.getByRole('button',{name:'Reset camera',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Controls',exact:true}).click();await page.screenshot({path:'test-results/final-mobile.png'});
 assert.deepEqual(await page.evaluate(()=>sphereLab.errors),[]);console.log('Count selector, GUI folders, cursor, orbit, pause and mobile layout passed.');
}finally{await browser.close();}
