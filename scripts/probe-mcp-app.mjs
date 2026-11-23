// Network-free MCP Apps host stub. Runs the actual view in a sandboxed iframe, completes its JSON-RPC
// initialize exchange and delivers real remote-tool results. Optional Playwright install is not a runtime dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/probe-mcp-app.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { remoteHarness, EXAMPLES } from '../test/mcp-harness.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = resolve(process.argv[2] ?? 'docs/round-xiii');
await mkdir(out, { recursive: true });
const remote = await remoteHarness();
const examples = [];
let html;
try {
  for (const example of EXAMPLES) {
    const call = { name: 'rank_cities', arguments: example.arguments };
    const result = await remote.client.callTool(call);
    assert.notEqual(result.isError, true);
    examples.push({ question: example.question, call, result });
  }
  const resource = await remote.client.readResource({ uri: 'ui://borgo/compare.html' });
  html = resource.contents[0].text;
} finally { await remote.close(); }
await writeFile(join(out, 'remote-examples.json'), JSON.stringify(examples, null, 2) + '\n');
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, colorScheme: theme });
    const errors = [];
    const requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.setContent('<!doctype html><html><body style="margin:0"><iframe id="view" sandbox="allow-scripts" style="border:0;width:100%;height:100px"></iframe></body></html>');
    await page.evaluate(({ html, theme }) => {
      document.body.style.background = theme === 'dark' ? '#181715' : '#fff';
      const iframe = document.getElementById('view');
      window.deliver = (result) => iframe.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
      window.ready = false;
      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow) return;
        const m = event.data;
        if (m.method === 'ui/initialize') iframe.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'Borgo test host', version: '1' }, hostCapabilities: {}, hostContext: { theme } } }, '*');
        if (m.method === 'ui/notifications/initialized') window.ready = true;
        if (m.method === 'ui/notifications/size-changed') iframe.style.height = Math.min(5000, m.params.height) + 'px';
      });
      iframe.srcdoc = html;
    }, { html, theme });
    await page.waitForFunction(() => window.ready === true);
    const frame = page.frameLocator('#view');
    for (const example of examples) {
      const view = example.result.structuredContent.view;
      await page.evaluate((r) => window.deliver(r), example.result);
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
      const bounds = await frame.locator('#app').boundingBox();
      assert.ok(bounds, 'rendered answer has visible geometry');
      await page.screenshot({ path: join(out, `${view}-${theme}.png`), clip: { x: 0, y: 0, width: 1000, height: Math.ceil(bounds.y + bounds.height + 14) } });
      checks.push({ theme, view, rows: 5, status: 'PASS' });
    }
    // Untrusted source, name, note and link text cannot become HTML or javascript.
    const hostile = structuredClone(examples[0].result);
    hostile.structuredContent.rows[0].name = '<img src=x onerror="window.pwned=true">';
    hostile.structuredContent.rows[0].sources[0].label = '<script>window.pwned=true</script>';
    hostile.structuredContent.link = 'javascript:window.pwned=true';
    await page.evaluate((r) => window.deliver(r), hostile);
    await frame.locator('h2').waitFor();
    assert.equal(await frame.locator('#app img, #app script, #app a[href^="javascript:"]').count(), 0);
    assert.equal(await frame.locator('#app > p a').count(), 0, 'unsafe Borgo link is not rendered');
    assert.ok((await frame.locator('#app').innerText()).includes('<img src=x'));
    // Host context can change on the same live document.
    await page.evaluate(() => document.getElementById('view').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, '*'));
    await frame.locator('html').evaluate((e) => new Promise((r) => requestAnimationFrame(() => r(getComputedStyle(e).colorScheme)))).then((s) => assert.equal(s, 'dark'));
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'view makes no network requests');
    checks.push({ theme, view: 'hostile text and live context', status: 'PASS' });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(join(out, 'app-harness.json'), JSON.stringify({ host: 'sandboxed iframe postMessage stub, not Claude or ChatGPT', browser: 'Chromium', checks }, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, failures: 0, out }));
