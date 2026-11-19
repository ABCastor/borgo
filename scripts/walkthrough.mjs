// Optional browser evidence, not part of the runtime. npm exec --package=playwright, or set
// PLAYWRIGHT_MODULE to an installed playwright index.mjs. CHROME selects an unbranded Chromium.
// A temporary extension uses chrome.tabs.setZoom: real browser zoom, not CSS zoom or pinch emulation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve('dist');
const out = resolve(process.env.SHOTS_DIR ?? '/tmp/borgo-walkthrough');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/')) throw new Error('path');
    const bytes = await readFile(file);
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const scratch = await mkdtemp(join(tmpdir(), 'borgo-ix-'));
const extension = join(scratch, 'extension');
await mkdir(extension);
await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Borgo zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {}); setInterval(() => chrome.runtime.getPlatformInfo(), 20000);');
const evidence = [];
const world = JSON.parse(await readFile(join(root, 'data/map.json'), 'utf8'));
const { project } = await import('../src/core/equal-earth.ts');
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const context = await chromium.launchPersistentContext(join(scratch, `${width}-${theme}`), {
      headless: true, executablePath: process.env.CHROME,
      viewport: { width, height: 1000 }, colorScheme: theme,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
    });
    try {
      console.log('walkthrough', width, theme);
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
      const page = context.pages()[0];
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const words = async selector => page.locator(selector).evaluate(el => {
        let text = el.innerText;
        for (const select of el.querySelectorAll('select')) text = text.replace(select.innerText, [...select.selectedOptions].map(o => o.textContent).join(' '));
        return text.trim().split(/\s+/).filter(Boolean).length;
      });
      const wordCounts = {};
      const shot = async name => {
        await page.screenshot({ path: join(out, `${width}-${theme}-${name}.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow: ${width}/${theme}/${name}`);
      };
      await page.goto(origin);
      await page.waitForSelector('#app .ask, .app .ask');
      await page.waitForFunction(() => !!document.querySelector('[data-act="setup-open"]') && !document.querySelector('.intro-wait'));
      assert.equal(await page.locator('.roster .cchip').count(), 0);
      wordCounts.walkthrough = await words('.intro');
      await shot('empty');
      for (let i = 0; i < 5; i++) {
        await page.locator(`[data-act="setup-step"][data-step="${i}"]`).first().click();
        await page.locator('#intro-h').scrollIntoViewIfNeeded();
        await shot(`setup-${i + 1}`);
      }
      await page.locator('[data-act="intro-hide"]').first().click();
      for (const city of ['Lisbon, Portugal', 'London, United Kingdom', 'Geneva, Switzerland']) {
        await page.locator('#add-city').fill(city);
        await page.locator('#add-city').press('Enter');
        await page.waitForTimeout(350);
      }
      await page.waitForFunction(() => document.querySelectorAll('.roster .cchip').length === 3);
      if (width < 820) await page.locator('[data-act="fold"]').click();
      await page.locator('[data-act="group"][data-id="money"]').click();
      await page.locator('#wg-money').scrollIntoViewIfNeeded();
      wordCounts.weightExplanation = await words('#vs-body > .vs-lede');
      wordCounts.moneyParts = await words('#vg-money');
      wordCounts.eligibility = await words('.elig');
      await shot('weights');
      await page.locator('[data-act="comfort"][data-where="values-tests"]').click();
      await page.locator('#cs-min').fill('16');
      await page.locator('#cs-min').press('Tab');
      await page.locator('#cs-max').fill('27');
      await page.locator('#cs-max').press('Tab');
      await page.locator('#nt-calm').check();
      await page.waitForTimeout(400);
      assert.match(await page.locator('.comfort-ed').innerText(), /Wind|wind/);
      assert.match(await page.locator('.wind-impact').innerText(), /days excluded/);
      await page.locator('.pop').evaluate(el => { el.scrollTop = 0; el.scrollIntoView({ block: 'start' }); });
      wordCounts.weatherEditor = await words('.comfort-ed');
      await shot('nice-days');
      await page.keyboard.press('Escape');
      await page.locator('[data-term="comfortable"]').first().click();
      assert.match(await page.locator('#tip').innerText(), /16 to 27/);
      await page.evaluate(() => location.hash = '#/map');
      await page.waitForSelector('#map-canvas');
      await page.waitForFunction(() => !document.querySelector('#map-load'));
      await page.locator('#map-canvas').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      wordCounts.mapHelp = await words('.mhow');
      await shot('map-score');
      // Exercise the real UI caller of refreshMap, not only the scoring engine.
      await page.locator('#third').selectOption('ambition');
      await page.locator('#work-kind').selectOption('software');
      const dial = async (id, value) => {
        await page.locator(id).evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
        await page.waitForTimeout(80);
      };
      await dial('#wg-money', 0);
      assert.equal(await page.locator('#sg-money').innerText(), '0%', 'expanded group explanation follows its live share');
      await dial('#wg-ambition', 100);
      await dial('#wg-climate', 1);
      const workScore = await page.locator('[data-act="map-pin"][data-city="london-gb"] .mr-v').innerText();
      await dial('#wg-ambition', 1);
      await dial('#wg-climate', 100);
      const weatherScore = await page.locator('[data-act="map-pin"][data-city="london-gb"] .mr-v').innerText();
      assert.notEqual(workScore, weatherScore, 'score lens updates after priorities change');
      evidence.push({ width, theme, liveScoreChange: { workScore, weatherScore } });
      await page.locator('[data-act="map-lens"][data-lens="nice_days"]').click();
      await page.locator('#map-canvas').scrollIntoViewIfNeeded();
      await shot('map-weather');
      // Test actual browser zoom and resize. The oracle projects independently named coordinates
      // in the World view, checks the backing buffer, then clicks those points and checks the card.
      for (const zoom of [0.67, 0.8, 1.1]) {
        console.log('zoom', width, theme, zoom);
        await worker.evaluate(async zoom => {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find(t => t.url?.startsWith('http://127.0.0.1:'));
          await chrome.tabs.setZoom(tab.id, zoom);
        }, zoom);
        for (const resized of [false, true]) {
          if (resized) await page.setViewportSize({ width: width - 30, height: 950 });
          await page.locator('[data-act="map-fit"][data-to="world"]').count().then(async count => {
            if (count) await page.locator('[data-act="map-fit"][data-to="world"]').evaluate(el => el.click());
          });
          await page.locator('#map-canvas').scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          const sizes = await page.locator('#map-canvas').evaluate(cv => ({ buffer: [cv.width, cv.height], rect: [cv.getBoundingClientRect().width, cv.getBoundingClientRect().height], dpr: devicePixelRatio }));
          assert.ok(Math.abs(sizes.buffer[0] - sizes.rect[0] * Math.min(2, sizes.dpr)) <= 2, JSON.stringify(sizes));
          const targets = [];
          for (const [name, lon, lat] of [['New York', -74.006, 40.713], ['London', -0.128, 51.507], ['Riyadh', 46.675, 24.714], ['Anchorage', -149.9, 61.218]]) {
            const [X, Y] = project(lon, lat);
            const xy = await page.locator('#map-canvas').evaluate((cv, { X, Y, world }) => {
              const W = cv.parentElement.clientWidth;
              const H = Math.round(W < 600 ? W * 0.92 : W / 2.05);
              const sc = W / (world.cols * world.pitch);
              const x = (X - (world.x0 + world.cols * world.pitch / 2)) * sc + W / 2;
              const y = ((world.y0 - world.rows * world.pitch / 2) - Y) * sc + H / 2;
              const r = cv.getBoundingClientRect();
              return { x: r.left + x * r.width / W, y: r.top + y * r.height / H };
            }, { X, Y, world });
            await page.mouse.move(xy.x, xy.y);
            await page.mouse.click(xy.x, xy.y);
            await page.waitForTimeout(80);
            const card = await page.locator('#map-card').innerText();
            assert.ok(card.toLowerCase().includes(name.toLowerCase()), `${name} at zoom ${zoom}, width ${width}: ${card}`);
            targets.push(name);
            await page.keyboard.press('Escape');
          }
          evidence.push({ width, theme, zoom, resized, ...sizes, pointerTargets: targets });
        }
      }
      await worker.evaluate(async () => { const tabs = await chrome.tabs.query({}); await chrome.tabs.setZoom(tabs.find(t => t.url?.startsWith('http://127.0.0.1:')).id, 1); });
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => location.hash = '#/');
      await page.waitForSelector('[data-act="reset"]');
      page.once('dialog', d => d.dismiss());
      await page.locator('[data-act="reset"]').click();
      assert.equal(await page.locator('.roster .cchip').count(), 3, 'cancel preserves comparison');
      page.once('dialog', d => d.accept());
      await page.locator('[data-act="reset"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.roster .cchip').length === 0);
      await page.locator('#intro-h').scrollIntoViewIfNeeded();
      await shot('reset');
      await page.reload();
      await page.waitForFunction(() => !!document.querySelector('[data-act="setup-open"]') && !document.querySelector('.intro-wait'));
      assert.equal(await page.locator('.roster .cchip').count(), 0, 'reset stays empty after reload');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('borgo:profile:v1')));
      assert.equal(saved.income.gross, 0);
      assert.equal(saved.income.everyday, null);
      assert.deepEqual(errors, []);
      evidence.push({ width, theme, walkthrough: 'passed', pageErrors: errors, wordCounts });
    } finally { await context.close(); }
  }
  await writeFile(join(out, 'walkthrough.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ screenshots: 44, checks: evidence.length, result: 'passed', wordCounts: evidence.find(e => e.wordCounts)?.wordCounts }));
} finally {
  await new Promise(r => server.close(r));
  await rm(scratch, { recursive: true, force: true });
}
