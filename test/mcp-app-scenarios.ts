// What the MCP App view does when a person clicks, checked in a real browser against a host stub that records the exact
// JSON-RPC the view sends. Used by test/mcp-app-browser.test.ts and scripts/probe-mcp-app.mjs, which also takes the
// screenshots. A scenario throws when a claim is false; its name says the claim.
import assert from "node:assert/strict";
import { loadDataset } from "../src/agent/dataset.ts";
import { BORGO_ORIGIN } from "../src/agent/share-link.ts";
import { CARD_METRICS } from "../src/mcp/measures.ts";
import { BARE_HOST, FULL_HOST, openHost, type HostCaps, type Opened, type Server } from "./mcp-app-host.ts";
import { siteOpens } from "./site-reader.ts";

export const RANK = { metric: "rent_1bed", order: "asc", filters: { region: "europe", ranges: [{ metric: "sunshine_hours", min: 2500 }] }, view: "ranked", limit: 5 };
export const WORLD = { criterion: "after_tax_rent", salary: { amount: 80000, currency: "EUR" }, view: "world", limit: 5 };
export const MONTHS = { criterion: "nice_days", view: "months", limit: 5 };
export const COMPARE = { cities: ["lisbon-pt", "turin-it", "berlin-de"], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR" } };

export interface Env { browser: any; server: Server; theme: "light" | "dark"; shot?: (o: Opened, name: string) => Promise<void> }
export interface Scenario { name: string; run(env: Env): Promise<void> }

/** The data-k of the element holding focus inside the view. */
const focused = (f: any) => f.locator("html").evaluate((h: HTMLElement) => (h.ownerDocument.activeElement as HTMLElement).dataset.k);
const settle = (o: Opened, ms = 600) => o.page.waitForTimeout(ms);
const toolCalls = async (o: Opened, name?: string) => (await o.calls("tools/call")).filter((c: any) => !name || c.name === name);
/** The URL of the last ui/open-link, read by the site's own share-link reader. */
const lastLink = async (o: Opened) => (await o.calls("ui/open-link")).at(-1)?.url as string;

async function ranked(env: Env, args: Record<string, unknown>, host: HostCaps = FULL_HOST, o?: { withMeta?: boolean; withInput?: boolean }) {
  const result: any = await env.server.call("rank_cities", args);
  assert.notEqual(result.isError, true);
  const page = await openHost(env.browser, env.server, { theme: env.theme, host });
  const delivered = o?.withMeta === false ? { ...result, _meta: undefined } : result;
  await page.deliver(args, delivered, { withInput: o?.withInput });
  await page.frame.locator("h2").first().waitFor();
  return { page, result };
}

async function compared(env: Env, args: Record<string, unknown>, host: HostCaps = FULL_HOST) {
  const result: any = await env.server.call("compare_cities", args);
  assert.notEqual(result.isError, true);
  const page = await openHost(env.browser, env.server, { theme: env.theme, host });
  await page.deliver(args, result);
  await page.frame.locator("h2").first().waitFor();
  return { page, result };
}

const done = async (o: Opened) => {
  assert.deepEqual(o.errors, [], "no uncaught page errors");
  assert.deepEqual(o.requests.filter((u) => !u.startsWith("about:") && !u.startsWith("data:")), [], "the view makes no network request");
  await o.close();
};

export const SCENARIOS: Scenario[] = [
  {
    name: "tools: each control calls rank_cities with the previous arguments and one change",
    async run(env) {
      const { page } = await ranked(env, RANK);
      const f = page.frame;
      await env.shot?.(page, "ranked-controls");
      await f.locator('select[data-ctl="measure"]').selectOption("criterion:clean_air");
      await settle(page);
      let calls = await toolCalls(page, "rank_cities");
      assert.deepEqual(calls.at(-1), { name: "rank_cities", arguments: { order: "asc", filters: RANK.filters, view: "ranked", limit: 5, criterion: "clean_air" } });
      assert.equal(await f.locator("h2").first().innerText(), "Clean air");
      await f.locator('select[data-ctl="order"]').selectOption("desc");
      await settle(page);
      calls = await toolCalls(page, "rank_cities");
      assert.deepEqual(calls.at(-1)!.arguments, { order: "desc", filters: RANK.filters, view: "ranked", limit: 5, criterion: "clean_air" });
      await f.locator('select[data-ctl="region"]').selectOption("asia-pacific");
      await settle(page);
      assert.deepEqual((await toolCalls(page, "rank_cities")).at(-1)!.arguments.filters, { region: "asia-pacific", ranges: RANK.filters.ranges });
      await f.locator('select[data-ctl="region"]').selectOption("");
      await settle(page);
      assert.deepEqual((await toolCalls(page, "rank_cities")).at(-1)!.arguments.filters, { ranges: RANK.filters.ranges });
      await f.locator('select[data-ctl="limit"]').selectOption("10");
      await settle(page);
      assert.equal((await toolCalls(page, "rank_cities")).at(-1)!.arguments.limit, 10);
      await f.locator('select[data-ctl="view"]').selectOption("world");
      await settle(page);
      assert.equal((await toolCalls(page, "rank_cities")).at(-1)!.arguments.view, "world");
      assert.ok(await f.locator(".city-dot").count() > 0, "the map draws the new answer");
      assert.equal((await page.calls("ui/message")).length, 0, "no model turn: nothing was said into the chat");
      await done(page);
    },
  },
  {
    name: "tools: a metric ranking changes to a priority line and back, with the better end first",
    async run(env) {
      const { page } = await ranked(env, RANK);
      const f = page.frame;
      assert.equal(await f.locator('select[data-ctl="measure"]').inputValue(), "metric:rent_1bed");
      await f.locator('select[data-ctl="measure"]').selectOption("criterion:nice_days");
      await settle(page);
      const a = (await toolCalls(page, "rank_cities")).at(-1)!.arguments;
      assert.deepEqual(a, { order: "desc", filters: RANK.filters, view: "months", limit: 5, criterion: "nice_days" });
      assert.equal(await f.locator(".month-cell").count(), 60, "five cities of twelve months");
      await f.locator('select[data-ctl="measure"]').selectOption("score");
      await settle(page);
      assert.deepEqual((await toolCalls(page, "rank_cities")).at(-1)!.arguments, { order: "desc", filters: RANK.filters, view: "ranked", limit: 5, score: true });
      await done(page);
    },
  },
  {
    name: "tools: the picker offers only rankings the person's details can answer, grouped",
    async run(env) {
      const { page } = await ranked(env, RANK);
      const f = page.frame;
      const labels = (sel: string) => f.locator(`${sel} option`).allInnerTexts();
      const bare = await labels('select[data-ctl="measure"]');
      assert.ok(bare.includes("Clean air") && bare.includes("Nice days") && bare.includes("Rent, one bedroom"));
      assert.ok(!bare.includes("Money left each month") && !bare.includes("Money after tax and rent"), "needs a salary");
      assert.ok((await f.locator('select[data-ctl="measure"] optgroup').count()) >= 8, "grouped as the site groups priorities");
      await done(page);
      const withPay = await ranked(env, WORLD);
      const paid = await withPay.page.frame.locator('select[data-ctl="measure"] option').allInnerTexts();
      assert.ok(paid.includes("Money after tax and rent"));
      assert.ok(!paid.includes("Money left each month"), "needs spending too");
      await done(withPay.page);
    },
  },
  {
    name: "city card: a row opens get_city and the three actions send the exact messages",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      const first = result.structuredContent.rows[0];
      await f.locator(".ranked-view .city-btn").first().click();
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      assert.deepEqual((await toolCalls(page, "get_city")).at(-1), { name: "get_city", arguments: { city: first.id, metrics: CARD_METRICS } });
      assert.ok((await f.locator(".card").innerText()).includes(first.name));
      assert.ok((await f.locator(".card tbody tr").count()) >= 3, "figures with their sources");
      assert.deepEqual(await f.locator(".card .btn").allInnerTexts(), ["Close", "Open in Borgo", `Ask about ${first.name}`, "Add to comparison"]);
      await env.shot?.(page, "detail-card");
      await f.getByRole("button", { name: `Ask about ${first.name}` }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/message")).at(-1), { role: "user", content: [{ type: "text", text: `Tell me more about living in ${first.name} for me` }] });
      await f.getByRole("button", { name: "Open in Borgo" }).click();
      await settle(page, 200);
      const url = await lastLink(page);
      assert.ok(url.startsWith(BORGO_ORIGIN + "/#share="));
      const opened = await siteOpens(url);
      assert.deepEqual(opened.cities, [first.id], "the site opens exactly that city");
      assert.equal(opened.profile.displayCurrency, "EUR");
      assert.deepEqual(opened.profile.weights, result._meta.borgo.share.weights, "with the weights the ranking used");
      assert.ok(!JSON.stringify(opened.profile.income).includes("80000"), "no pay in the link");
      await done(page);
    },
  },
  {
    name: "selection: Add to comparison and checkboxes feed Compare in chat and Open these in Borgo",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      const [a, b, c] = result.structuredContent.rows;
      await f.locator(".ranked-view .city-btn").first().click();
      await f.getByRole("button", { name: "Add to comparison" }).click();
      assert.equal(await f.locator(".selection").count(), 1);
      assert.ok((await f.locator(".selection").innerText()).includes("1 selected"));
      assert.equal(await f.getByRole("button", { name: "Compare in chat" }).count(), 0, "needs two");
      await f.getByRole("checkbox", { name: `Select ${b.name}` }).check();
      await f.getByRole("button", { name: "Compare in chat" }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/message")).at(-1), { role: "user", content: [{ type: "text", text: `Compare ${a.name} and ${b.name} for me` }] });
      await f.getByRole("checkbox", { name: `Select ${c.name}` }).check();
      await env.shot?.(page, "multi-select");
      await f.getByRole("button", { name: "Compare in chat" }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/message")).at(-1), { role: "user", content: [{ type: "text", text: `Compare ${a.name}, ${b.name} and ${c.name} for me` }] });
      await f.getByRole("button", { name: "Open these in Borgo" }).click();
      await settle(page, 200);
      const opened = await siteOpens(await lastLink(page));
      assert.deepEqual(opened.cities, [a.id, b.id, c.id], "the site opens all of them, in the order picked");
      await f.getByRole("button", { name: "Clear" }).click();
      assert.equal(await f.locator(".selection").count(), 0);
      await done(page);
    },
  },
  {
    name: "model context: each change tells the model what the person is looking at",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      assert.equal((await page.calls("ui/update-model-context")).length, 0, "nothing before the person does something");
      const b = result.structuredContent.rows[1];
      await f.getByRole("checkbox", { name: `Select ${b.name}` }).check();
      await settle(page, 900);
      let last = (await page.calls("ui/update-model-context")).at(-1);
      assert.deepEqual(last.structuredContent.selected, [b.id]);
      assert.equal(last.structuredContent.ranked, "Rent, one bedroom");
      assert.equal(last.structuredContent.top.length, 5);
      assert.ok(last.content[0].text.includes(`Selected: ${b.name}`) && last.content[0].text.includes("lowest first") && last.content[0].text.includes("Europe"));
      await f.locator('select[data-ctl="measure"]').selectOption("criterion:clean_air");
      await settle(page, 1500);
      last = (await page.calls("ui/update-model-context")).at(-1);
      assert.equal(last.structuredContent.ranked, "Clean air");
      assert.ok(last.content[0].text.includes("Clean air"));
      await done(page);
    },
  },
  {
    name: "full screen: offered for the map when the host lists it, and asked for and given back",
    async run(env) {
      const { page } = await ranked(env, WORLD);
      const f = page.frame;
      await f.getByRole("button", { name: "Full screen" }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/request-display-mode")).at(-1), { mode: "fullscreen" });
      await f.getByRole("button", { name: "Exit full screen" }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/request-display-mode")).at(-1), { mode: "inline" });
      await env.shot?.(page, "world");
      await done(page);
      const none = await ranked(env, WORLD, { capabilities: FULL_HOST.capabilities, displayModes: ["inline"] });
      assert.equal(await none.page.frame.getByRole("button", { name: /full screen/i }).count(), 0);
      await done(none.page);
      const bars = await ranked(env, RANK);
      assert.equal(await bars.page.frame.getByRole("button", { name: /full screen/i }).count(), 0, "only the map offers it");
      await done(bars.page);
    },
  },
  {
    name: "map: a dot opens the same card, by pointer and by keyboard",
    async run(env) {
      const { page, result } = await ranked(env, WORLD);
      const f = page.frame;
      const [a, b] = result.structuredContent.rows;
      await f.locator(`.city-dot[data-open="${a.id}"]`).click({ force: true });
      await f.locator(".card h3").waitFor();
      assert.ok((await f.locator(".card h3").innerText()).startsWith(a.name));
      await f.locator(`.city-dot[data-open="${b.id}"]`).focus();
      await page.page.keyboard.press("Enter");
      await settle(page, 800);
      assert.ok((await f.locator(".card h3").innerText()).startsWith(b.name));
      assert.equal(await f.locator(".city-dot").first().getAttribute("role"), "button");
      await done(page);
    },
  },
  {
    name: "compare: the default result draws (the summary shape) with a ranking table and the chart",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      assert.equal(await f.locator(".compare-table tbody tr").count(), 3);
      assert.ok(await f.locator("svg[role=img]").count() >= 1);
      assert.ok(!(await f.locator("#app").innerText()).includes("Could not draw"));
      assert.ok((await f.locator("#app").innerText()).includes(result.structuredContent.verdict));
      await done(page);
      // detail "full" returns the full report: it draws too, with the same sliders.
      const full = await compared(env, { ...COMPARE, detail: "full" });
      assert.ok((await full.page.frame.locator("h2").first().innerText()).startsWith("Borgo: "));
      assert.equal(await full.page.frame.locator("svg[role=img]").count(), 1);
      assert.ok(await full.page.frame.locator("input[type=range]").count() > 5);
      assert.ok(!(await full.page.frame.locator("#app").innerText()).includes("Could not draw"));
      await done(full.page);
    },
  },
  {
    name: "compare: a slider re-scores in the frame through compare_cities, with every weight carried",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const lines = result.structuredContent.lines as { id: string; weight: number }[];
      assert.equal(await f.locator('input[type=range]').count(), lines.length);
      const was = await f.locator(".compare-table tbody tr td:nth-child(3)").allInnerTexts();
      await f.locator('input[data-w="money_left"]').fill("80");
      await settle(page, 1500);
      const call = (await toolCalls(page, "compare_cities")).at(-1)!;
      assert.deepEqual(call.arguments, { ...COMPARE, weights: Object.fromEntries(lines.map((l) => [l.id, l.id === "money_left" ? 80 : l.weight])) });
      const direct: any = await env.server.call("compare_cities", call.arguments);
      const now = await f.locator(".compare-table tbody tr td:nth-child(3)").allInnerTexts();
      assert.deepEqual(now, direct.structuredContent.ranking.map((r: any) => r.total.toFixed(1)), "the frame shows what the server worked out");
      assert.notDeepEqual(now, was, "the scores moved");
      assert.equal(await f.locator('input[data-w="money_left"]').inputValue(), "80");
      assert.equal((await page.calls("ui/message")).length, 0, "no model turn");
      await env.shot?.(page, "compare-sliders");
      await f.getByRole("button", { name: "Reset to the first answer" }).click();
      await settle(page, 1500);
      assert.equal(await f.locator('input[data-w="money_left"]').inputValue(), String(lines[0]!.weight));
      assert.deepEqual(await f.locator(".compare-table tbody tr td:nth-child(3)").allInnerTexts(), was);
      await done(page);
    },
  },
  {
    name: "compare: keyboard steps on a slider make one call, and the city card and Borgo link work",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const before = (await toolCalls(page, "compare_cities")).length;
      await f.locator('input[data-w="safety"]').focus();
      await page.page.keyboard.press("ArrowRight");
      await page.page.keyboard.press("ArrowRight");
      await settle(page, 1500);
      const calls = await toolCalls(page, "compare_cities");
      assert.equal(calls.length, before + 1, "two steps, one question");
      const safety = (result.structuredContent.lines as any[]).find((l) => l.id === "safety").weight;
      assert.equal(calls.at(-1)!.arguments.weights.safety, safety + 2);
      assert.equal(await focused(f), "w:safety", "focus stays on the slider");
      await f.getByRole("button", { name: "Open this comparison in Borgo" }).click();
      await settle(page, 200);
      const opened = await siteOpens(await lastLink(page));
      assert.deepEqual(opened.cities, COMPARE.cities);
      assert.equal(opened.profile.weights.safety, safety + 2, "the link carries the weights on screen");
      await f.locator(".compare-table .city-btn").first().click();
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      assert.equal((await toolCalls(page, "get_city")).at(-1)!.arguments.city, result.structuredContent.ranking[0].id);
      assert.deepEqual(await f.locator(".card .btn").allInnerTexts(), ["Close", "Open in Borgo", `Ask about ${result.structuredContent.ranking[0].name}`]);
      await done(page);
    },
  },
  {
    name: "hosts that also deliver the view's own calls as tool results do not undo a click",
    async run(env) {
      const result: any = await env.server.call("rank_cities", RANK);
      const page = await openHost(env.browser, env.server, { theme: env.theme, echo: true });
      await page.deliver(RANK, result);
      await page.frame.locator("h2").first().waitFor();
      const rows = result.structuredContent.rows;
      await page.frame.getByRole("checkbox", { name: `Select ${rows[0].name}` }).check();
      await page.frame.locator('select[data-ctl="limit"]').selectOption("10");
      await settle(page, 1200);
      assert.equal(await page.frame.locator(".rank-table tbody tr").count(), 7, "all seven that match, the new answer");
      assert.ok(await page.frame.getByRole("checkbox", { name: `Select ${rows[0].name}` }).isChecked(), "the pick survived the new answer and its echo");
      assert.equal((await toolCalls(page, "rank_cities")).length, 1, "the echo did not start another call");
      await done(page);
    },
  },
  {
    name: "hidden capabilities: a host that lists nothing gets the plain chart, no controls and no buttons",
    async run(env) {
      for (const [args, name] of [[RANK, "ranked"], [WORLD, "world"], [MONTHS, "months"]] as const) {
        const { page } = await ranked(env, args, BARE_HOST);
        const f = page.frame;
        assert.equal(await f.locator("#app button, #app select, #app input, #app [data-open]").count(), 0, `${name}: nothing to click`);
        assert.equal(await f.locator("#app > p a").count(), 1, `${name}: the plain link to Borgo stays`);
        await done(page);
      }
      const c = await compared(env, COMPARE, BARE_HOST);
      assert.equal(await c.page.frame.locator("#app button, #app input, #app select").count(), 0);
      await done(c.page);
    },
  },
  {
    name: "hidden capabilities: each one alone shows only what it makes possible",
    async run(env) {
      const only = async (capabilities: Record<string, unknown>, check: (o: Opened, names: any) => Promise<void>) => {
        const { page, result } = await ranked(env, RANK, { capabilities, displayModes: ["inline"] });
        await check(page, result.structuredContent.rows.map((r: any) => r.name));
        await done(page);
      };
      await only({ serverTools: {} }, async (o, names) => {
        const f = o.frame;
        assert.equal(await f.locator(".controls select").count(), 5, "re-query controls");
        assert.equal(await f.locator('[type=checkbox]').count(), 0, "nothing to do with a selection");
        await f.locator(".ranked-view .city-btn").first().click();
        await f.locator(".card h3").waitFor();
        await settle(o, 800);
        assert.deepEqual(await f.locator(".card .btn").allInnerTexts(), ["Close"], "no way to open, ask or add");
        assert.ok((await f.locator(".card tbody tr").count()) >= 3);
        assert.equal(await f.locator(`.city-dot`).count(), 0);
        void names;
      });
      await only({ openLinks: {} }, async (o, names) => {
        const f = o.frame;
        assert.equal(await f.locator(".controls").count(), 0, "cannot ask the server again");
        await f.locator(".ranked-view .city-btn").first().click();
        assert.deepEqual(await f.locator(".card .btn").allInnerTexts(), ["Close", "Open in Borgo", "Add to comparison"]);
        assert.equal((await toolCalls(o)).length, 0, "no tool calls without serverTools");
        await f.getByRole("checkbox", { name: `Select ${names[1]}` }).check();
        await f.getByRole("button", { name: "Add to comparison" }).click();
        assert.deepEqual(await f.locator(".selection .btn").allInnerTexts(), ["Open these in Borgo", "Clear"]);
      });
      await only({ message: { text: {} } }, async (o, names) => {
        const f = o.frame;
        assert.equal(await f.locator(".controls").count(), 0);
        await f.locator(".ranked-view .city-btn").first().click();
        assert.deepEqual(await f.locator(".card .btn").allInnerTexts(), ["Close", `Ask about ${names[0]}`, "Add to comparison"]);
        await f.getByRole("checkbox", { name: `Select ${names[1]}` }).check();
        await f.getByRole("button", { name: "Add to comparison" }).click();
        assert.deepEqual(await f.locator(".selection .btn").allInnerTexts(), ["Compare in chat", "Clear"]);
      });
      await only({ message: { image: {} } }, async (o) => {
        assert.equal(await o.frame.locator("#app button, #app input, #app select, #app [data-open]").count(), 0, "a host that takes no text is not offered messages");
      });
      await only({ serverTools: {}, updateModelContext: { text: {} } }, async (o, names) => {
        await o.frame.locator('select[data-ctl="limit"]').selectOption("10");
        await settle(o, 1500);
        const sent = (await o.calls("ui/update-model-context")).at(-1);
        assert.ok(sent.content[0].text.includes(names[0]));
        assert.equal(sent.structuredContent, undefined, "only the kinds of content the host lists");
      });
      await only({ serverTools: {} }, async (o) => {
        await o.frame.locator('select[data-ctl="limit"]').selectOption("10");
        await settle(o, 1200);
        assert.equal((await o.calls("ui/update-model-context")).length, 0, "no context call to a host that does not take it");
      });
    },
  },
  {
    name: "hidden capabilities: with no way to know the arguments, re-ranking is hidden; tool-input is the fallback",
    async run(env) {
      const none = await ranked(env, RANK, FULL_HOST, { withMeta: false, withInput: false });
      assert.equal(await none.page.frame.locator(".controls").count(), 0, "no query: no controls");
      assert.ok(await none.page.frame.locator(".ranked-view .city-btn").count() > 0, "rows still open");
      await done(none.page);
      const input = await ranked(env, RANK, FULL_HOST, { withMeta: false });
      await input.page.frame.locator('select[data-ctl="limit"]').selectOption("10");
      await settle(input.page);
      assert.deepEqual((await toolCalls(input.page, "rank_cities")).at(-1)!.arguments, { ...RANK, limit: 10 });
      await done(input.page);
    },
  },
  {
    name: "errors: a refused or failed call says so, keeps the chart, and the controls stay usable",
    async run(env) {
      const result: any = await env.server.call("rank_cities", RANK);
      const page = await openHost(env.browser, env.server, { theme: env.theme, refuse: ["tools/call"] });
      await page.deliver(RANK, result);
      await page.frame.locator("h2").first().waitFor();
      await page.frame.locator('select[data-ctl="limit"]').selectOption("10");
      await settle(page);
      assert.ok((await page.frame.locator('[data-k="status"]').innerText()).startsWith("Could not update"));
      assert.equal(await page.frame.locator(".rank-bar").count(), 5, "the chart is unchanged");
      assert.equal(await page.frame.locator('select[data-ctl="limit"]').inputValue(), "5", "the control shows what is on screen");
      await done(page);
      const bad = await ranked(env, { ...RANK, metric: "rent_1bed" });
      await bad.page.frame.locator('select[data-ctl="measure"]').selectOption("criterion:clean_air");
      await settle(bad.page);
      await done(bad.page);
    },
  },
  {
    name: "access: targets are at least 44px, focus moves to the card and back, controls are named",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      const small = await f.locator(".btn, select, .city-btn, .tick").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5).map((e) => e.className + ":" + e.textContent));
      assert.deepEqual(small, [], "every button, select, row link and checkbox is 44px");
      for (const label of ["Rank by", "Order", "Region", "Show", "As"]) assert.equal(await f.getByLabel(label, { exact: true }).count(), 1, label);
      const row = f.locator(".ranked-view .city-btn").first();
      await row.focus();
      await page.page.keyboard.press("Enter");
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      assert.equal(await focused(f), "card");
      assert.equal(await f.locator(".card").getAttribute("aria-labelledby"), "card-title");
      await page.page.keyboard.press("Escape");
      assert.equal(await f.locator(".card").count(), 0);
      assert.equal(await focused(f), `open:${result.structuredContent.rows[0].id}`, "focus returns to the row");
      assert.equal(await f.locator('[role=status][aria-live=polite]').count(), 1);
      await done(page);
      const c = await compared(env, COMPARE);
      const sliders = await c.page.frame.locator(".slider").evaluateAll((els: HTMLElement[]) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(sliders.every((h: number) => h >= 43.5), "slider rows are 44px");
      assert.equal(await c.page.frame.locator("input[type=range][aria-valuetext]").count(), sliders.length);
      await done(c.page);
    },
  },
  {
    name: "theme: follows the host's dark and light, and a changed theme applies to the open view",
    async run(env) {
      const { page } = await ranked(env, RANK);
      assert.equal(await page.frame.locator("html").evaluate((e: HTMLElement) => getComputedStyle(e).colorScheme), env.theme);
      await page.push({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: env.theme === "dark" ? "light" : "dark" } });
      await settle(page, 200);
      assert.equal(await page.frame.locator("html").evaluate((e: HTMLElement) => getComputedStyle(e).colorScheme), env.theme === "dark" ? "light" : "dark");
      await done(page);
    },
  },
  {
    name: "safety: hostile names, sources and links stay text, in every view and in the card",
    async run(env) {
      const result: any = await env.server.call("rank_cities", RANK);
      const hostile = structuredClone(result);
      hostile.structuredContent.rows[0].name = '<img src=x onerror="window.pwned=true">';
      hostile.structuredContent.rows[0].id = 'x"><img src=x onerror="window.pwned=true">';
      hostile.structuredContent.rows[0].sources[0].label = "<script>window.pwned=true</script>";
      hostile.structuredContent.link = "javascript:window.pwned=true";
      const page = await openHost(env.browser, env.server, { theme: env.theme });
      await page.deliver(RANK, hostile);
      await page.frame.locator("h2").first().waitFor();
      await page.frame.locator(".ranked-view .city-btn").first().click();
      await settle(page, 600);
      assert.equal(await page.frame.locator("#app img, #app script, #app a[href^=javascript]").count(), 0);
      assert.ok((await page.frame.locator("#app").innerText()).includes("<img src=x"));
      assert.equal(await page.page.evaluate(() => (window as any).pwned), undefined);
      await done(page);
    },
  },
];

export { BARE_HOST, FULL_HOST };
export const DATA = () => loadDataset();
