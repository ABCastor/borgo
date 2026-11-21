import { readFile } from 'node:fs/promises';
import { firstProfile } from '../src/ui/state.ts';

/** DOM geometry, not screenshots: checks text fragments and controls against layout boundaries.
 * Deliberate scrollports (the comparison and coverage tables) are checked at their visible clipping edge.
 * Rules are section dividers, not table-row borders or the outline of a card/control.
 */
export async function layoutHits(page) {
  return page.evaluate(() => {
    const hits = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) hits.push({kind:'viewport',width:innerWidth,scrollWidth:document.documentElement.scrollWidth});
    const visible = el => {
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false;
      for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open && !p.querySelector(':scope > summary')?.contains(el)) return false;
      return true;
    };
    const name = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
    const check = (el, rect, kind) => {
      if (!rect.width || !rect.height) return;
      let left = 0, right = innerWidth;
      let top = -Infinity, bottom = Infinity, verticalScroll = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const css = getComputedStyle(p), r = p.getBoundingClientRect();
        if (['auto','scroll'].includes(css.overflowY) && p.scrollHeight > p.clientHeight + 1) verticalScroll = true;
        if (p.matches('.cmp-wrap, .cov-wrap') && ['auto', 'scroll'].includes(css.overflowX) && p.scrollWidth > p.clientWidth + 1) return;
        if (p.matches('section, article, li, td, th, .sheet, .pop, .vgroup, .fld, .elig-head, .setup-controls, .rtl, .hh-person, .hh-row') || ['hidden', 'clip'].includes(css.overflowX)) {
          left = Math.max(left, r.left); right = Math.min(right, r.right);
          // Plain sections have no enclosing box: condensed headlines deliberately overshoot their line box.
          // Vertical containment applies to actual cards/cells and clipping boundaries, not those ink overshoots.
          if (!verticalScroll && (p.matches('.sheet, .pop, article, .vgroup, td, th, .fld') || ['hidden','clip'].includes(css.overflowY))) {top = Math.max(top,r.top);bottom = Math.min(bottom,r.bottom);}
        }
      }
      if (rect.top < top - 1.5 || rect.bottom > bottom + 1.5) hits.push({kind:`${kind}-vertical`,element:name(el),text:el.textContent.trim().slice(0,90),bounds:[rect.top,rect.bottom],container:[top,bottom]});
      if (rect.left < left - 1.5 || rect.right > right + 1.5) hits.push({ kind, element: name(el), text: el.textContent.trim().slice(0, 90), bounds: [rect.left, rect.right], container: [left, right] });
    };
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('svg, script, style, .sr, [hidden]')) continue;
      if (el.matches('input, select, textarea, button, a.pill-btn')) check(el, el.getBoundingClientRect(), 'control');
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) check(el, rect, 'text');
      }
    }
    const actions = [...document.querySelectorAll('.ai-setup .setup-controls .pill-btn')].filter(visible);
    const heights = actions.map(el => el.getBoundingClientRect().height);
    if (heights.length && Math.max(...heights)-Math.min(...heights)>1) hits.push({kind:'alignment',element:'.ai-setup .pill-btn',heights});
    const rules = [];
    for (const el of document.querySelectorAll('header, section, .intro, .ai-setup, .ask, .vs-sum, .vgroup, .elig, .more, .map-help, hr')) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      if (parseFloat(s.borderTopWidth) > 0) rules.push({ y: r.top, left: r.left, right: r.right, element: name(el) });
      if (parseFloat(s.borderBottomWidth) > 0) rules.push({ y: r.bottom, left: r.left, right: r.right, element: name(el) });
    }
    rules.sort((a, b) => a.y - b.y);
    for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length && rules[j].y - rules[i].y < 32; j++) {
      const a = rules[i], b = rules[j];
      if (Math.min(a.right,b.right) - Math.max(a.left,b.left) > 40) hits.push({ kind: 'double-rule', elements: [a.element,b.element], gap: b.y-a.y });
    }
    return hits;
  });
}

export async function populatedAudit(context, origin, root) {
  const reports = [];
  const empty = await context.newPage();
  await empty.goto(origin);
  await empty.waitForFunction(() => !!document.querySelector('[data-act="setup-open"]') && !document.querySelector('.intro-wait'));
  reports.push({route:'empty-with-intro',hits:await layoutHits(empty)});
  await empty.close();
  const data = JSON.parse(await readFile(`${root}/data/dataset.json`, 'utf8'));
  const p = firstProfile(data);
  p.cities = ['lisbon-pt', 'london-gb', 'audit-fetched'];
  p.household = [{label:'You',citizenships:['IT','GB']},{label:'Partner',citizenships:['US'],relation:'partner'}];
  p.income.gross = 60000;
  p.weights = {...p.weights, happiness:20, sea:15, research:12};
  p.dealBreakers = ['right_to_live'];
  const original = data.cities.find(c => c.id === 'geneva-ch');
  const fetched = {city:{...original,id:'audit-fetched',name:'Fetched-style Geneva'},observations:structuredClone(data.observations['geneva-ch'] ?? []),outcomes:[],fetchedAt:new Date().toISOString()};
  const page = await context.newPage();
  page.on('pageerror', e => console.error('audit page error', e));
  await page.addInitScript(({p,fetched}) => { localStorage.setItem('borgo:profile:v1',JSON.stringify(p));localStorage.setItem('borgo:city:audit-fetched',JSON.stringify(fetched)); }, {p,fetched});
  for (const route of ['/', '/map', '/compare', '/money', '/data']) {
    console.log('audit route', route);
    await page.goto(`${origin}/#${route}`);
    await page.waitForFunction(() => !!document.querySelector('#page') && !document.querySelector('.intro-wait'));
    if (route !== '/data') await page.waitForSelector('[data-act="setup-open"]', { state: 'attached' });
    if (route === '/map') await page.waitForFunction(() => !!document.querySelector('#map-canvas') && !document.querySelector('#map-load'));
    const fold = page.locator('[data-act="fold"]');
    if (await fold.isVisible() && await fold.getAttribute('aria-expanded') !== 'true') await fold.click();
    await page.waitForTimeout(200);
    reports.push({route,hits:await layoutHits(page)});
    if (route === '/') {
      for (const group of await page.locator('[data-act="group"][aria-expanded="false"]').all()) await group.click();
      reports.push({route:'expanded-priorities',hits:await layoutHits(page)});
      await page.locator('[data-act="household"]').first().click();
      reports.push({route:'people-editor',hits:await layoutHits(page)});
      await page.keyboard.press('Escape');
      await page.locator('[data-act="comfort"][data-where="values-tests"]').click();
      reports.push({route:'nice-day-editor',hits:await layoutHits(page)});
      await page.keyboard.press('Escape');
    }
  }
  await page.evaluate(() => localStorage.clear());
  await page.close();
  return reports;
}
