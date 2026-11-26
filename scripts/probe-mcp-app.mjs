// Network-free MCP Apps host stub. Runs the actual view in a sandboxed iframe, completes its JSON-RPC initialize
// exchange, delivers real remote-tool results, answers the view's tools/call with Borgo's real remote handler and
// records every message the view sends. Three parts: the three answer views drawn for a host that offers nothing
// (hostile text and live theme included), every interaction of test/mcp-app-scenarios.ts with the exact JSON-RPC it
// sends, and the screenshots (light and dark). Optional Playwright install is not a runtime dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs [BROWSER=chromium|webkit|firefox] node scripts/probe-mcp-app.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { EXAMPLES } from '../test/mcp-harness.ts';
import { BARE_HOST, borgoServer, launch, loadPlaywright, openHost } from '../test/mcp-app-host.ts';
import { SCENARIOS } from '../test/mcp-app-scenarios.ts';
const playwright = await loadPlaywright();
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to the absolute path of playwright/index.mjs');
const engine = process.env.BROWSER ?? 'chromium';
const out = resolve(process.argv[2] ?? 'docs/round-xiv');
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
        assert.ok((await frame.locator('.world-view path').getAttribute('d')).length > 1000);
      }
      if (view === 'months') assert.equal(await frame.locator('.month-cell').count(), 60);
      assert.ok((await frame.locator('#app').innerText()).includes(example.result.structuredContent.rows[0].name));
      assert.equal(await frame.locator('html').evaluate((e) => getComputedStyle(e).colorScheme), theme);
      assert.equal(await frame.locator('#app button, #app select, #app input').count(), 0, 'a host that lists no capability gets no controls');
      const bounds = await frame.locator('#app').boundingBox();
      assert.ok(bounds, 'rendered answer has visible geometry');
      await o.page.screenshot({ path: join(out, `plain-${view}-${theme}.png`), clip: { x: 0, y: 0, width: 1000, height: Math.ceil(bounds.y + bounds.height + 14) } });
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
    assert.equal(await frame.locator('#app > p a').count(), 0, 'unsafe Borgo link is not rendered');
    assert.ok((await frame.locator('#app').innerText()).includes('<img src=x'));
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
      await opened.page.screenshot({ path: join(out, `${name}-${theme}.png`), clip: { x: 0, y: 0, width: 1000, height: Math.ceil(box.y + box.height + 14) } });
    };
    for (const s of SCENARIOS) {
      await s.run({ browser, server, theme, shot });
      checks.push({ theme, scenario: s.name, status: 'PASS' });
    }
  }
} finally { await browser.close(); await server.close(); }
await writeFile(join(out, 'app-harness.json'), JSON.stringify({ host: 'sandboxed iframe postMessage stub, not Claude or ChatGPT', browser: engine, checks }, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, failures: 0, out }));
