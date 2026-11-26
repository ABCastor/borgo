import assert from 'node:assert/strict';
import { join } from 'node:path';

// Round XV in the real app: the header on one line, the standard catalogue (nice days added from Weather), the X on a
// priority and on a line, wins and loses opened in place (sheet and Compare), the priorities sliding to their new order
// only once a dial is released, the map ramp to green, and the section change moving one white card from its old box
// to its new one. Every step goes through the interface; nothing is written to storage directly.

const profile = page => page.evaluate(() => JSON.parse(localStorage.getItem('borgo:profile:v1')));
const showSide = async page => {
  const fold = page.locator('[data-act="fold"]');
  if (await fold.isVisible() && await fold.getAttribute('aria-expanded') !== 'true') await fold.click();
};
const groupsInOrder = page => page.locator('.vgroups > [data-group]').evaluateAll(els => els.map(el => el.dataset.group));

/** The header: the name, the sections and the three tools share one centre line, within 1 px. */
export async function headerLine(page, out, width, theme) {
  await page.evaluate(() => scrollTo(0, 0));
  const m = await page.evaluate(() => {
    const cy = el => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const name = document.querySelector('.bmast .bname');
    const sections = [...document.querySelectorAll('.bmast .desktop-sections, .bmast .phone-sections > summary')].filter(shown);
    const tools = [...document.querySelectorAll('.bmast .bar-tools > button')].filter(shown);
    return { name: cy(name), sections: sections.map(cy), tools: tools.map(cy), icons: tools.map(b => cy(b.querySelector('svg'))) };
  });
  assert.equal(m.tools.length, 3, 'share, theme and settings');
  for (const y of [...m.sections, ...m.tools, ...m.icons]) assert.ok(Math.abs(y - m.name) <= 1, `header line ${width}/${theme}: ${JSON.stringify(m)}`);
  await page.locator('.bmast').screenshot({ path: join(out, `${width}-${theme}-xv-header.png`) });
  return m;
}

/** Weather off with its X, back with Undo, off again; then nice days added from Add priority's Weather group. */
export async function niceDaysFromCatalogue(page, shot) {
  await page.evaluate(() => location.hash = '#/');
  await page.waitForFunction(() => document.body.dataset.route === 'cities');
  await showSide(page);
  if (!await page.locator('[data-group="climate"]').count()) {
    await page.locator('#side .priority-catalogue > button').click();
    await page.locator('#side [data-act="add-priority"][data-id="climate"]').click();
  }
  const x = page.locator('#side [data-group="climate"] .prio-x[data-act="remove-priority"]');
  assert.equal(await x.getAttribute('aria-label'), 'Remove Weather');
  const box = await x.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `X target ${JSON.stringify(box)}`);
  const before = (await profile(page)).weights.nice_days;
  // Keyboard: the X is a button in the tab order.
  await x.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#side [data-group="climate"]'));
  assert.equal((await profile(page)).weights.nice_days, 0);
  await page.waitForFunction(() => document.activeElement?.matches('.undo button'));
  assert.match(await page.locator('#side .undo').innerText(), /Weather removed\. Undo/);
  await page.locator('#side .undo').scrollIntoViewIfNeeded();
  await shot('xv-removed-x');
  await page.locator('#side [data-act="undo-priority"]').click();
  await page.waitForSelector('#side [data-group="climate"]');
  assert.equal((await profile(page)).weights.nice_days, before, 'Undo puts the same weight back');
  await page.locator('#side [data-group="climate"] .prio-x').click();
  await page.waitForFunction(() => !document.querySelector('#side [data-group="climate"]'));
  // Add priority: the catalogue shows Weather and its lines; nice days is one click.
  await page.locator('#side .priority-catalogue > button').click();
  const weather = page.locator('#priority-options .cat-g', { has: page.locator('h3', { hasText: /^Weather$/ }) });
  assert.match(await weather.innerText(), /Nice days[\s\S]*Sunshine[\s\S]*Winter daylight/);
  assert.match(await page.locator('#priority-options .cat-start').innerText(), /Most people start with/i);
  await page.locator('#priority-options .cat-start').scrollIntoViewIfNeeded();
  await shot('xv-catalogue');
  await weather.locator('[data-act="line"][data-id="nice_days"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('borgo:profile:v1')).weights.nice_days > 0);
  assert.equal(await page.locator('#priority-options').isVisible(), true, 'the catalogue stays open to tick more');
  assert.equal(await weather.locator('[data-act="line"][data-id="nice_days"]').getAttribute('aria-pressed'), 'true');
  const line = page.locator('#side [data-group="climate"] .vg-on .vg-line.is-nice');
  assert.match(await line.innerText(), /Nice days[\s\S]*Edit weather tests/);
  await page.locator('#side [data-group="climate"]').scrollIntoViewIfNeeded();
  await shot('xv-nice-days-added');
  await page.locator('#side .priority-catalogue > button').click();
  assert.equal(await page.locator('#priority-options').isVisible(), false);
}

/** A line of Weather: added from the open group, taken out with its own X, back with Undo. */
export async function lineX(page, shot) {
  await showSide(page);
  const group = page.locator('#side [data-group="climate"]');
  if (await group.locator('[data-act="group"]').getAttribute('aria-expanded') !== 'true') await group.locator('[data-act="group"]').click();
  await group.locator('.chips [data-act="line"][data-id="sunshine"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('borgo:profile:v1')).weights.sunshine > 0);
  const x = group.locator('.vline .prio-x[data-act="line"][data-id="sunshine"]');
  assert.equal(await x.getAttribute('aria-label'), 'Remove Sunshine');
  await x.scrollIntoViewIfNeeded();
  await shot('xv-line-before-x');
  await x.click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('borgo:profile:v1')).weights.sunshine === 0);
  assert.match(await page.locator('#side .undo').innerText(), /Sunshine removed/);
  assert.equal(await group.locator('.chips [data-act="line"][data-id="sunshine"]').count(), 1, 'back among the lines to add');
  await shot('xv-line-x');
  await page.locator('#side [data-act="undo-line"]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('borgo:profile:v1')).weights.sunshine > 0);
  await group.locator('.vline .prio-x[data-act="line"][data-id="sunshine"]').click();
  await group.locator('[data-act="group"]').click();
}

/** Wins and loses: a sheet opens every line in place; Compare opens every city's list together. */
export async function winsLosesOpen(page, shot) {
  await page.evaluate(() => location.hash = '#/');
  await page.waitForSelector('article.dos [data-act="wl"]');
  const card = page.locator('article.dos').first();
  const rows = await card.locator('.wl').count();
  const toggle = card.locator('[data-act="wl"]');
  assert.match(await toggle.innerText(), /See all \d+ lines/i);
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('article.dos [data-act="wl"]')?.getAttribute('aria-expanded') === 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.act), 'wl', 'focus stays on the button');
  const opened = page.locator('article.dos').first();
  assert.ok(await opened.locator('.wl').count() >= rows);
  await opened.scrollIntoViewIfNeeded();
  await page.waitForTimeout(450);
  await shot('xv-wins-open');
  await opened.locator('[data-act="wl"]').click();
  await page.evaluate(() => location.hash = '#/compare');
  await page.waitForSelector('.cmp-wl [data-act="wl"]');
  await page.locator('.cmp-wl [data-act="wl"]').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.cmp-wl [data-act="wl"]')].every(b => b.getAttribute('aria-expanded') === 'true'));
  await page.locator('.cmp-wl').scrollIntoViewIfNeeded();
  await shot('xv-compare-wins');
  await page.locator('.cmp-wl [data-act="wl"]').first().click();
}

/** Priorities slide to their new order on the dial's release, never while it moves; reduced motion jumps. */
export async function releaseReorder(page, shot, file) {
  await page.evaluate(() => location.hash = '#/');
  await page.waitForFunction(() => document.body.dataset.route === 'cities');
  await showSide(page);
  // Two groups at least: add Safety if only one counts.
  if ((await groupsInOrder(page)).length < 2) {
    await page.locator('#side .priority-catalogue > button').click();
    await page.locator('#side [data-act="add-priority"][data-id="safety"]').click();
  }
  const set = (id, value, kind) => page.locator(`#wg-${id}`).evaluate((el, [value, kind]) => { el.value = String(value); el.dispatchEvent(new Event(kind, { bubbles: true })); }, [value, kind]);
  const run = async reduced => {
    const order = await groupsInOrder(page);
    const [first, last] = [order[0], order.at(-1)];
    await set(first, 30, 'input'); await set(first, 30, 'change');
    await set(last, 5, 'input'); await set(last, 5, 'change');
    await page.waitForTimeout(500);
    const start = await groupsInOrder(page);
    const mover = start.at(-1);
    // Dragging: the dial moves, the shares follow, the rows stay where they are.
    for (const v of [20, 50, 90]) {
      await set(mover, v, 'input');
      assert.deepEqual(await groupsInOrder(page), start, 'no reorder while the dial moves');
      assert.equal(await page.locator('.vgroups > [data-group]').evaluateAll(els => els.filter(el => el.getAnimations().length).length), 0);
    }
    await set(mover, 90, 'change');
    const end = await groupsInOrder(page);
    assert.equal(end[0], mover, 'released, the heaviest priority leads');
    const moving = await page.locator('.vgroups > [data-group]').evaluateAll(els => els.filter(el => el.getAnimations().some(a => a.effect?.getTiming().duration === 420)).map(el => el.dataset.group));
    if (reduced) assert.deepEqual(moving, [], 'reduced motion: rows jump');
    else assert.ok(moving.includes(mover), `rows slide on release: ${moving}`);
    return { start, end, moving };
  };
  const smooth = await run(false);
  await page.waitForTimeout(120);
  await page.locator('#side').screenshot({ path: file('xv-reorder-mid') });
  await page.waitForTimeout(400);
  await shot('xv-reorder');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const jump = await run(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { smooth, jump };
}

/** The map's ramp ends in green in both themes, the same values on the legend and the canvas palette. */
export async function mapRamp(page, theme, shot) {
  await page.evaluate(() => location.hash = '#/map');
  await page.waitForSelector('#map-canvas');
  await page.waitForFunction(() => !document.querySelector('#map-load'));
  await page.locator('[data-act="map-lens"][data-lens="score"]').click();
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.querySelector('.msheet').append(probe);
    const read = v => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    const out = { lo: read('--map-lo'), mid: read('--map-mid'), hi: read('--map-hi'), legend: getComputedStyle(document.querySelector('.mlg-ramp')).backgroundImage };
    probe.remove();
    return out;
  });
  const expected = theme === 'light' ? { lo: 'rgb(250, 224, 138)', hi: 'rgb(11, 93, 42)' } : { lo: 'rgb(96, 81, 32)', hi: 'rgb(121, 223, 131)' };
  assert.equal(colours.lo, expected.lo); assert.equal(colours.hi, expected.hi);
  assert.ok(colours.legend.includes(expected.hi), colours.legend);
  await page.locator('#map-canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('xv-map-ramp');
  return colours;
}

/**
 * The section change moves one white card: sampled every frame, its box never leaves the range between its start and
 * end sizes (no growing first, then sliding). Frames at 0, ½ and 1 are kept as evidence.
 */
export async function sectionMorph(page, out, width, theme) {
  await page.evaluate(() => location.hash = '#/map');
  await page.waitForSelector('#map-canvas');
  await page.waitForFunction(() => !document.querySelector('#map-load') && !!document.querySelector('[data-vt-card]'));
  await page.waitForTimeout(400);
  const results = [];
  for (const to of ['#/compare', '#/map']) {
    const r = await page.evaluate(async to => {
      const box = () => { const b = document.querySelector('[data-vt-card]')?.getBoundingClientRect(); return b && { w: b.width, h: b.height }; };
      const from = box();
      const frames = [];
      let done = false;
      const sample = () => {
        const cs = getComputedStyle(document.documentElement, '::view-transition-group(main-card)');
        const w = parseFloat(cs.width), h = parseFloat(cs.height);
        if (w > 0) frames.push({ w, h });
        if (!done) requestAnimationFrame(sample);
      };
      const start = document.startViewTransition.bind(document);
      let vt;
      document.startViewTransition = fn => (vt = start(fn));
      location.hash = to;
      await new Promise(r => setTimeout(r, 0));
      document.startViewTransition = start;
      requestAnimationFrame(sample);
      await vt?.finished.catch(() => {});
      done = true;
      return { to, from, end: box(), frames, ran: !!vt };
    }, to);
    assert.ok(r.ran && r.from && r.end, `a card on both sides: ${JSON.stringify(r)}`);
    assert.ok(r.frames.length >= 3, `the card's box was sampled while it moved: ${r.frames.length}`);
    for (const k of ['w', 'h']) {
      const lo = Math.min(r.from[k], r.end[k]) - 1, hi = Math.max(r.from[k], r.end[k]) + 1;
      for (const f of r.frames) assert.ok(f[k] >= lo && f[k] <= hi, `${to} ${k} ${f[k]} outside ${lo}..${hi}`);
    }
    results.push({ to, from: r.from, end: r.end, frames: r.frames.length, widths: [...new Set(r.frames.map(f => Math.round(f.w)))], heights: r.frames.map(f => Math.round(f.h)) });
    await page.waitForTimeout(300);
  }
  // Frames for the eye: paused at 0, ½ and 1 of the map-to-compare change.
  await page.evaluate(async () => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = fn => (window.__xvVT = start(fn));
    location.hash = '#/compare';
    await new Promise(r => setTimeout(r, 0));
    document.startViewTransition = start;
    await window.__xvVT.ready;
    for (const a of document.getAnimations()) a.pause();
  });
  for (const f of [0, 0.5, 1]) {
    await page.evaluate(f => { for (const a of document.getAnimations()) { const d = a.effect.getComputedTiming().duration; a.currentTime = Math.min(d - 0.01, f * d); } }, f);
    await page.waitForTimeout(80);
    await page.screenshot({ path: join(out, `${width}-${theme}-xv-morph-${f}.png`) });
  }
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await page.waitForFunction(() => document.body.dataset.route === 'compare');
  return results;
}

export async function roundXv(page, { out, width, theme, shot }) {
  const header = await headerLine(page, out, width, theme);
  await niceDaysFromCatalogue(page, shot);
  await lineX(page, shot);
  await winsLosesOpen(page, shot);
  const reorder = await releaseReorder(page, shot, name => join(out, `${width}-${theme}-${name}.png`));
  const ramp = await mapRamp(page, theme, shot);
  const morph = await sectionMorph(page, out, width, theme);
  await page.evaluate(() => location.hash = '#/');
  await page.waitForFunction(() => document.body.dataset.route === 'cities');
  return { header, reorder, ramp, morph };
}
