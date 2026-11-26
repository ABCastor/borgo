// Network-free MCP Apps host stub. Runs the actual view in a sandboxed iframe, completes its JSON-RPC initialize
// exchange, delivers real remote-tool results, answers the view's tools/call with Borgo's real remote handler and
// records every message the view sends, under the spec's default CSP. Four parts: the three ranking views drawn for a
// host that offers nothing (hostile text and live theme included), every interaction of test/mcp-app-scenarios.ts with
// the exact JSON-RPC it sends, its screenshots (light and dark, 1000 px), and the pieces of the site in a chat column
// (728 px) and on a phone (390 px): nice days with the definition open, the map with its labels, a city dossier, a
// comparison with wins and losses open, the money waterfall. Optional Playwright install is not a runtime dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs [BROWSER=chromium|webkit|firefox] node scripts/probe-mcp-app.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { EXAMPLES } from '../test/mcp-harness.ts';
import { BARE_HOST, borgoServer, launch, loadPlaywright, openHost } from '../test/mcp-app-host.ts';
import { COMPARE, NICE, SCENARIOS, WORLD } from '../test/mcp-app-scenarios.ts';
const playwright = await loadPlaywright();
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to the absolute path of playwright/index.mjs');
const engine = process.env.BROWSER ?? 'chromium';
const out = resolve(process.argv[2] ?? 'docs/round-xv-chat');
await mkdir(out, { recursive: true });
const server = await borgoServer();
const examples = [];
try {
  for (const example of EXAMPLES) {
    const call = { name: 'rank_cities', arguments: example.arguments };
    const result = await server.call(call.name, call.arguments);
    assert.notEqual(result.isError, true);
    examples.push({ question: example.question, call, result });
  }
} catch (e) { await server.close(); throw e; }
await writeFile(join(out, 'remote-examples.json'), JSON.stringify(examples, null, 2) + '\n');
const browser = await launch(playwright);
const checks = [];
try {
  for (const theme of ['light', 'dark']) {
    // 1. A host that offers nothing draws what the view always drew.
    const o = await openHost(browser, server, { theme, host: BARE_HOST });
    const frame = o.frame;
    for (const example of examples) {
      const view = example.result.structuredContent.view;
      await o.deliver(example.call.arguments, example.result);
      await frame.locator('h2').filter({ hasText: example.result.structuredContent.label }).waitFor();
      assert.equal(await frame.locator('.rank-table tbody tr').count(), 5);
      if (view === 'ranked') assert.equal(await frame.locator('.rank-bar').count(), 5);
      if (view === 'world') {
        assert.equal(await frame.locator('.city-dot').count(), 5);
        assert.ok((await frame.locator('.world-view g.land path').evaluateAll((ps) => ps.map((p) => p.getAttribute('d')).join(''))).length > 100000, 'the land, tile by tile');
      }
      if (view === 'months') assert.equal(await frame.locator('.month-cell').count(), 60);
      assert.ok((await frame.locator('#app').textContent()).includes(example.result.structuredContent.rows[0].name));
      assert.equal(await frame.locator('html').evaluate((e) => getComputedStyle(e).colorScheme), theme);
      assert.equal(await frame.locator('#app button, #app select, #app input').count(), 0, 'a host that lists no capability gets no controls');
      const bounds = await frame.locator('#app').boundingBox();
      assert.ok(bounds, 'rendered answer has visible geometry');
      await o.page.screenshot({ fullPage: true, path: join(out, `plain-${view}-${theme}.png`), clip: { x: 0, y: 0, width: 1000, height: Math.ceil(bounds.y + bounds.height + 14) } });
      checks.push({ theme, scenario: `plain ${view}: no capability, no control`, status: 'PASS' });
    }
    // Untrusted source, name, note and link text cannot become HTML or javascript.
    const hostile = structuredClone(examples[0].result);
    hostile.structuredContent.rows[0].name = '<img src=x onerror="window.pwned=true">';
    hostile.structuredContent.rows[0].sources[0].label = '<script>window.pwned=true</script>';
    hostile.structuredContent.link = 'javascript:window.pwned=true';
    await o.deliver(examples[0].call.arguments, hostile);
    await frame.locator('h2').waitFor();
    assert.equal(await frame.locator('#app img, #app script, #app a[href^="javascript:"]').count(), 0);
    assert.equal(await frame.locator('a[data-borgo-link]').count(), 0, 'unsafe Borgo link is not rendered');
    assert.ok((await frame.locator('#app').textContent()).includes('<img src=x'));
    await o.push({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } });
    assert.equal(await frame.locator('html').evaluate((e) => new Promise((r) => requestAnimationFrame(() => r(getComputedStyle(e).colorScheme)))), 'dark');
    assert.deepEqual(o.errors, []);
    assert.deepEqual(o.requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:')), [], 'view makes no network requests');
    checks.push({ theme, scenario: 'hostile text and live context', status: 'PASS' });
    await o.close();
    // 2. Every interaction, with the exact JSON-RPC asserted inside each scenario.
    const shot = async (opened, name) => {
      await opened.page.waitForTimeout(300);
      const box = await opened.page.locator('#view').boundingBox();
      await opened.page.screenshot({ fullPage: true, path: join(out, `${name}-${theme}.png`), clip: { x: 0, y: 0, width: 1000, height: Math.ceil(box.y + box.height + 14) } });
    };
    for (const s of SCENARIOS) {
      await s.run({ browser, server, theme, shot });
      checks.push({ theme, scenario: s.name, status: 'PASS' });
    }
    // 3. The pieces of the site, in a chat column and on a phone.
    const pieces = [
      ['nice-days-editor', 'rank_cities', NICE, async (f) => { await f.locator('[data-act="nice"]').click(); }],
      ['map-labels', 'rank_cities', { ...WORLD, limit: 10 }, null],
      ['city-dossier', 'get_city', { city: 'lisbon-pt' }, null],
      ['compare-wins-losses', 'compare_cities', COMPARE, async (f) => { await f.locator('[data-act="why"]').nth(1).click(); }],
      ['money-waterfall', 'compare_cities', COMPARE, async (f) => { await f.getByRole('radio', { name: 'Money' }).click(); }],
      ['compare-map', 'compare_cities', COMPARE, async (f) => { await f.getByRole('radio', { name: 'Map' }).click(); }],
    ];
    for (const width of [728, 390]) for (const [name, tool, args, act] of pieces) {
      const o = await openHost(browser, server, { theme, viewport: { width, height: 900 } });
      const result = await server.call(tool, args);
      assert.notEqual(result.isError, true);
      await o.deliver(args, result);
      await o.frame.locator('h2').first().waitFor();
      if (act) await act(o.frame);
      await o.page.waitForTimeout(1200);
      assert.deepEqual(o.errors, []);
      assert.deepEqual(await o.frame.locator('html').evaluate(() => window.__violations), []);
      const wide = await o.frame.locator('html').evaluate((h) => h.scrollWidth > h.clientWidth);
      assert.equal(wide, false, `${name} at ${width}: nothing wider than the column`);
      const box = await o.page.locator('#view').boundingBox();
      await o.page.screenshot({ fullPage: true, path: join(out, `${name}-${width}-${theme}.png`), clip: { x: 0, y: 0, width, height: Math.ceil(box.y + box.height) } });
      checks.push({ theme, scenario: `${name} at ${width} px: drawn, no page error, no CSP violation, no sideways scroll`, status: 'PASS' });
      await o.close();
    }
  }
} finally { await browser.close(); await server.close(); }
await writeFile(join(out, 'app-harness.json'), JSON.stringify({ host: 'sandboxed iframe postMessage stub under the MCP Apps default CSP, not Claude or ChatGPT', browser: engine, checks }, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, failures: 0, out }));
