import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { project } from '../src/core/equal-earth.ts';
const world = JSON.parse(await readFile('dist/data/map.json', 'utf8'));
const dataset = JSON.parse(await readFile('dist/data/dataset.json', 'utf8'));
const cityPoints = dataset.cities.map(c => project(c.lon,c.lat));
const landSamples = [];
for (let i=0;i<world.tiles.length;i+=3) {
  const [col,row,cc] = world.tiles.slice(i,i+3);
  if (!['US','ES','FR','DE','GB','IT','AU'].includes(world.countries[cc])) continue;
  const X=world.x0+(col+.5)*world.pitch,Y=world.y0-(row+.5)*world.pitch;
  if (cityPoints.every(([x,y])=>Math.hypot(X-x,Y-y)>world.pitch*3)) landSamples.push([col,row]);
}

export async function roundXiiStart(page, theme, shot) {
  const cycle=[];
  for(const choice of ['light','dark','system']) {
    await page.locator('[data-theme-toggle]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme-choice'),choice);
    assert.equal(await page.evaluate(()=>localStorage.getItem('borgo:theme')),choice);
    cycle.push(choice);
  }
  await page.locator('[data-theme-toggle]').click();
  await page.reload();
  await page.waitForSelector('[data-film]');
  assert.equal(await page.locator('html').getAttribute('data-theme-choice'),'light');
  await page.locator('[data-theme-toggle]').click();
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light dark');
  await page.locator('[data-film]').click();
  assert.equal(await page.locator('.film-dialog video').getAttribute('preload'),'none');
  assert.equal(await page.locator('.film-dialog video').getAttribute('autoplay'),null);
  assert.match(await page.locator('.film-dialog').innerText(),/Happy Soul.*Ketsa/);
  await page.locator('.film-dialog video').evaluate(async video=>{
    const image=new Image(); image.src=video.poster;
    await image.decode();
    if(!image.naturalWidth) throw Error('Missing poster');
  });
  await shot('film-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.film-dialog', {state:'detached'});
  assert.equal(await page.locator('.film-dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-film')),true);
  await page.locator('[data-act="share"]').click();
  assert.equal(await page.locator('.share [data-act="share-copy"]').textContent(),'Copy');
  assert.ok((await page.locator('#share-url').inputValue()).includes('#share='));
  const shareWords=(await page.locator('.share').innerText()).trim().split(/\s+/).length;
  assert.ok(shareWords<35);
  await shot('share-panel');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__nativeShare=data}}));
  await page.locator('[data-act="share"]').click();
  await page.locator('[data-act="share-native"]').click();
  assert.ok((await page.evaluate(()=>window.__nativeShare.url)).includes('#share='));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>delete navigator.share);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{window.__transitions=0; window.__startVT=document.startViewTransition?.bind(document); document.startViewTransition=fn=>{window.__transitions++;return window.__startVT(fn)};location.hash='#/compare'});
  await page.waitForFunction(()=>document.body.dataset.route==='compare');
  assert.equal(await page.evaluate(()=>window.__transitions),0);
  await page.evaluate(()=>{document.startViewTransition=window.__startVT;location.hash='#/'});
  await page.waitForFunction(()=>document.body.dataset.route==='cities');
  await page.emulateMedia({reducedMotion:'no-preference'});
  return {cycle,persistedReload:true,film:true,shareWords,nativeShareStub:true,reducedMotion:true,theme};
}

export async function roundXiiLand(page,shot) {
  await page.locator('[data-act="map-lens"][data-lens="score"]').click();
  for(const id of ['safety','health']) {
    const add=page.locator(`[data-act="add-priority"][data-id="${id}"]`);
    if(await add.count()) {
      if(await page.locator('.priority-catalogue > button').getAttribute('aria-expanded')!=='true') await page.locator('.priority-catalogue > button').click();
      await add.click();
    }
  }
  const timings=[];
  const dial=async(id,value)=>timings.push(await page.locator(id).evaluate(async(el,value)=>{const start=performance.now();el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);return performance.now()-start},value));
  await dial('#wg-safety',100); await dial('#wg-health',1);
  await page.waitForTimeout(150);
  // Tile centres at least three grid cells from every published city: dots cannot satisfy this check.
  const landHash=()=>page.locator('#map-canvas').evaluate((cv,{landSamples,world})=>{
    const ctx=cv.getContext('2d');
    return landSamples.map(([col,row])=>{
      const x=Math.round((col+.5)*cv.width/world.cols);
      const y=Math.round((row+.5-world.rows/2)*cv.width/world.cols+cv.height/2);
      return x>=0 && y>=0 && x<cv.width && y<cv.height ? [...ctx.getImageData(x,y,1,1).data].join(',') : '';
    });
  },{landSamples,world});
  const before=await landHash();
  await dial('#wg-safety',1); await dial('#wg-health',100);
  await page.waitForTimeout(150);
  const after=await landHash();
  const changed=before.filter((color,i)=>color!==after[i]).length;
  console.log('land recolour', {samples:before.length,changed,timings});
  assert.ok(changed>=10,'at least ten city-free land tile centres recolour with priorities');
  assert.match(await page.locator('#map-legend').innerText(),/Land: .*% of your priorities/);
  await page.locator('#map-canvas').scrollIntoViewIfNeeded();
  await shot('land-recoloured');
  return {samples:before.length,changed,inputToFrameMs:timings,legend:await page.locator('#map-legend').innerText()};
}
