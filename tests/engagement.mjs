import {regularChrome} from './helpers/regular-chrome.mjs';
import {nativeHTML} from './helpers/native-site.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const f=await regularChrome('engagement-ui');
await f.ctx.route('https://www.tiktok.com/**',r=>{
 const body=nativeHTML('creator',{hydrated:true}).replaceAll('"playCount":100','"playCount":100,"diggCount":5,"commentCount":3,"shareCount":2').replaceAll('"playCount":101','"playCount":101,"diggCount":1,"commentCount":1,"shareCount":0');
 return r.fulfill({contentType:'text/html',body});
});
try{
 const home=await f.ctx.newPage();await home.goto('https://www.tiktok.com/@creator');await f.send('GRANT_DONE',{platform:'tiktok'});
 await f.send('START',{rows:[{url:'https://www.tiktok.com/@creator'}],config:{sourcePlatform:'tiktok',statsDays:30,brands:''}});
 const s=await f.wait(s=>s.run.status==='finished');assert.equal(s.rows[0].result.engagementRateMax,.1);
 await f.app.reload();await f.app.waitForSelector('#table-body tr');
 const index=await f.app.locator('#table-head th').evaluateAll(ths=>ths.findIndex(th=>th.textContent==='互动率（Max）'));
 assert.ok(index>0);assert.equal(await f.app.locator('#table-body tr').first().locator('td').nth(index).textContent(),'10.00%');
 await f.app.evaluate(()=>{navigator.clipboard.writeText=async text=>{globalThis.engagementClipboard=text;};});await f.app.locator('#copy').click();
 await f.app.waitForFunction(()=>!!globalThis.engagementClipboard);assert.match(await f.app.evaluate(()=>globalThis.engagementClipboard),/10\.00%/);
 await f.app.locator('#table-body tr').first().click();assert.equal(await f.app.locator('#edit-engagementRateMax').inputValue(),'10.00%');assert.equal(await f.app.locator('#edit-engagementRateMax').evaluate(e=>e.readOnly),true);
 await f.app.locator('#save-row').click();assert.equal((await f.send('GET')).rows[0].result.engagementRateMax,.1);
 await f.app.locator('#columns-open').click();assert.equal(await f.app.locator('.column-item[data-key=engagementRateMax]').count(),1);await f.app.locator('[data-close=columns-dialog]').first().click();
 await f.app.screenshot({path:path.join(f.out,'互动率Max结果列.png')});
 await writeFile('outputs/engagement-ui-regression.json',JSON.stringify({passed:true,scope:'Isolated fixture browser',table:'10.00%',clipboard:'10.00%',computedFieldReadOnly:true,columnSettings:true},null,2));console.log('Engagement MAX table, percentage clipboard, column settings and detail save passed.');
}finally{await f.ctx.close();}
