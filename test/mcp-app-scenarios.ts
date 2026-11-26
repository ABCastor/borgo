// What the MCP App view does when a person clicks, checked in a real browser against a host stub that records the exact
// JSON-RPC the view sends, under the spec's default CSP. Used by test/mcp-app-browser.test.ts and
// scripts/probe-mcp-app.mjs, which also takes the screenshots. A scenario throws when a claim is false; its name says
// the claim. Text is read with textContent: the view sets names and labels in caps through CSS, as the site does.
import assert from "node:assert/strict";
import { loadDataset } from "../src/agent/dataset.ts";
import { money } from "../src/agent/chart.ts";
import { BORGO_ORIGIN } from "../src/agent/share-link.ts";
import { CARD_METRICS, CLIMATE_METRICS } from "../src/mcp/measures.ts";
import { comfortOf, comparison, nextComfort, winsLosses, type Comfort } from "../src/mcp/view-draw.ts";
import { BARE_HOST, FULL_HOST, openHost, type HostCaps, type Opened, type Server } from "./mcp-app-host.ts";
import { siteOpens } from "./site-reader.ts";

export const RANK = { metric: "rent_1bed", order: "asc", filters: { region: "europe", ranges: [{ metric: "sunshine_hours", min: 2500 }] }, view: "ranked", limit: 5 };
export const WORLD = { criterion: "after_tax_rent", salary: { amount: 80000, currency: "EUR" }, view: "world", limit: 5 };
export const MONTHS = { criterion: "nice_days", view: "months", limit: 5 };
export const NICE = { criterion: "nice_days", view: "ranked", limit: 5 };
export const COMPARE = { cities: ["lisbon-pt", "turin-it", "berlin-de"], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR" } };
export const CITY = { city: "lisbon-pt" };
export const PAY = { country: "PT", gross: 60000 };

export interface Env { browser: any; server: Server; theme: "light" | "dark"; shot?: (o: Opened, name: string) => Promise<void> }
export interface Scenario { name: string; run(env: Env): Promise<void> }

/** The data-k of the element holding focus inside the view. */
const focused = (f: any) => f.locator("html").evaluate((h: HTMLElement) => (h.ownerDocument.activeElement as HTMLElement).dataset.k);
const settle = (o: Opened, ms = 600) => o.page.waitForTimeout(ms);
const toolCalls = async (o: Opened, name?: string) => (await o.calls("tools/call")).filter((c: any) => !name || c.name === name);
/** The URL of the last ui/open-link, read by the site's own share-link reader. */
const lastLink = async (o: Opened) => (await o.calls("ui/open-link")).at(-1)?.url as string;
const text = async (loc: any) => String(await loc.textContent()).trim();
/** What each button is called: its label, else its words. */
const names = (loc: any): Promise<string[]> => loc.evaluateAll((els: HTMLElement[]) => els.map((e) => e.getAttribute("aria-label") ?? (e.textContent ?? "").trim()));

async function opened(env: Env, tool: string, args: Record<string, unknown>, host: HostCaps = FULL_HOST, o?: { withMeta?: boolean; withInput?: boolean; viewport?: { width: number; height: number } }) {
  const result: any = await env.server.call(tool, args);
  assert.notEqual(result.isError, true);
  const page = await openHost(env.browser, env.server, { theme: env.theme, host, viewport: o?.viewport });
  const delivered = o?.withMeta === false ? { ...result, _meta: undefined } : result;
  await page.deliver(args, delivered, { withInput: o?.withInput });
  await page.frame.locator("h2").first().waitFor();
  return { page, result };
}
const ranked = (env: Env, args: Record<string, unknown>, host: HostCaps = FULL_HOST, o?: { withMeta?: boolean; withInput?: boolean }) => opened(env, "rank_cities", args, host, o);
const compared = (env: Env, args: Record<string, unknown>, host: HostCaps = FULL_HOST) => opened(env, "compare_cities", args, host);

const done = async (o: Opened) => {
  assert.deepEqual(o.errors, [], "no uncaught page errors");
  assert.deepEqual(o.requests.filter((u) => !u.startsWith("about:") && !u.startsWith("data:")), [], "the view makes no network request");
  assert.deepEqual(await o.frame.locator("html").evaluate(() => (window as any).__violations), [], "nothing the host's default CSP blocks");
  await o.close();
};

/** Months whose high sits in the range, by the chart's own test (src/mcp/view-draw.ts climateChart). */
const inRange = (highs: number[], c: Comfort) => highs.filter((h) => h >= c.min - 0.5 && h < c.max + 0.5).length;

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
      assert.equal(await text(f.locator("h2").first()), "Clean air");
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
      await f.getByRole("radio", { name: "Map" }).click();
      await settle(page);
      assert.equal((await toolCalls(page, "rank_cities")).at(-1)!.arguments.view, "world");
      assert.ok(await f.locator(".city-dot").count() > 0, "the map draws the new answer");
      assert.equal(await f.getByRole("radio", { name: "Map" }).getAttribute("aria-checked"), "true");
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
      const labels = (sel: string) => f.locator(`${sel} option`).allTextContents();
      const bare = await labels('select[data-ctl="measure"]');
      assert.ok(bare.includes("Clean air") && bare.includes("Nice days") && bare.includes("Rent, one bedroom"));
      assert.ok(!bare.includes("Money left each month") && !bare.includes("Money after tax and rent"), "needs a salary");
      assert.ok((await f.locator('select[data-ctl="measure"] optgroup').count()) >= 8, "grouped as the site groups priorities");
      await done(page);
      const withPay = await ranked(env, WORLD);
      const paid = await withPay.page.frame.locator('select[data-ctl="measure"] option').allTextContents();
      assert.ok(paid.includes("Money after tax and rent"));
      assert.ok(!paid.includes("Money left each month"), "needs spending too");
      await done(withPay.page);
    },
  },
  {
    name: "nice days: the definition is edited in place, the way the site edits it, and each edit re-ranks through rank_cities with no model turn",
    async run(env) {
      const { page, result } = await ranked(env, NICE);
      const f = page.frame;
      let c = comfortOf(NICE, result._meta.borgo.share);
      assert.equal(await text(f.locator('[data-act="nice"]')), "18–30° feels");
      assert.equal(await f.locator("#niced").count(), 0, "closed until asked for");
      await f.locator('[data-act="nice"]').click();
      assert.equal(await f.locator('[data-act="nice"]').getAttribute("aria-expanded"), "true");
      assert.deepEqual(await f.locator("#niced .nt b").allTextContents(), ["Dry", "Sunny", "Not muggy", "Calm", "Daylight"], "the site's tests, the same words");
      const step = async (sel: string, change: Parameters<typeof nextComfort>[1], act: () => Promise<void>) => {
        const before = (await toolCalls(page, "rank_cities")).length;
        await act();
        await settle(page, 1400);
        c = nextComfort(c, change);
        const calls = await toolCalls(page, "rank_cities");
        assert.equal(calls.length, before + 1, `${sel}: one call`);
        assert.deepEqual(calls.at(-1), { name: "rank_cities", arguments: { ...NICE, comfort: c } }, `${sel}: the previous arguments and the new definition`);
        const direct: any = await env.server.call("rank_cities", calls.at(-1)!.arguments);
        assert.deepEqual(await f.locator(".vrows .mr-name").allTextContents(), direct.structuredContent.rows.map((r: any) => r.name), `${sel}: the frame shows what the server ranked`);
        assert.equal(await f.locator("#niced").count(), 1, `${sel}: the editor stays open`);
      };
      await step("warmer", { step: "max", d: 1 }, () => f.getByRole("button", { name: "Warmest nice daytime temperature warmer" }).click());
      assert.equal(await focused(f), "nice:max+", "focus stays on the stepper");
      await step("not sunny", { test: "clear", on: false }, () => f.getByRole("checkbox", { name: /Sunny/ }).uncheck());
      await step("calm", { test: "calm", on: true }, () => f.getByRole("checkbox", { name: /Calm/ }).check());
      await step("daylight", { daylight: 12 }, () => f.locator("[data-nice-daylight]").selectOption("12"));
      await step("air", { basis: "air" }, () => f.getByRole("radio", { name: "Air" }).click());
      assert.deepEqual(c, { min: 18, max: 31, basis: "air", clear: false, calm: true, daylight: 12 });
      assert.equal(await text(f.locator('[data-act="nice"]')), "18–31° air");
      // Two quick steps are one question.
      const before = (await toolCalls(page, "rank_cities")).length;
      // Both presses in one moment (each redraws the editor, so the second finds the new button).
      await f.locator("#niced").evaluate((ed: HTMLElement) => { for (let i = 0; i < 2; i++) ed.ownerDocument.querySelector<HTMLElement>('[data-k="nice:min+"]')!.click(); });
      await settle(page, 1400);
      const calls = await toolCalls(page, "rank_cities");
      assert.equal(calls.length, before + 1, "two steps, one question");
      assert.equal(calls.at(-1)!.arguments.comfort.min, 20);
      await env.shot?.(page, "nice-editor");
      assert.equal((await page.calls("ui/message")).length, 0, "no model turn");
      await done(page);
    },
  },
  {
    name: "nice days: a comparison that counts them re-scores through compare_cities with the new definition",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const c = nextComfort(comfortOf(COMPARE, result._meta.borgo.share), { step: "min", d: -2 });
      await f.locator('[data-act="nice"]').click();
      // Both presses in one moment, so they are one question whatever the browser's pace.
      await f.locator("#niced").evaluate((ed: HTMLElement) => { for (let i = 0; i < 2; i++) ed.ownerDocument.querySelector<HTMLElement>('[data-k="nice:min-"]')!.click(); });
      await settle(page, 1600);
      assert.equal((await toolCalls(page, "compare_cities")).length, 1, "one question");
      const call = (await toolCalls(page, "compare_cities")).at(-1)!;
      assert.deepEqual(call, { name: "compare_cities", arguments: { ...COMPARE, comfort: c } });
      const direct: any = await env.server.call("compare_cities", call.arguments);
      assert.deepEqual(await f.locator(".compare-table tbody tr td:nth-child(3)").allTextContents(), direct.structuredContent.ranking.map((r: any) => r.total.toFixed(1)));
      await done(page);
    },
  },
  {
    name: "city card: a row opens get_city and the three actions send the exact messages",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      const first = result.structuredContent.rows[0];
      await f.locator(".vrows .city-btn").first().click();
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      assert.deepEqual((await toolCalls(page, "get_city")).at(-1), { name: "get_city", arguments: { city: first.id, metrics: [...CARD_METRICS, ...CLIMATE_METRICS] } });
      assert.equal(await text(f.locator(".card h3")), first.name);
      assert.ok((await f.locator(".card .fig").count()) >= 3, "figures with their sources");
      assert.equal(await f.locator(".card .dclim .mb").count(), 12, "the year, month by month");
      assert.deepEqual(await names(f.locator(".card button")), [`Close ${first.name} details`, "Open in Borgo", `Ask about ${first.name}`, "Add to comparison"]);
      await env.shot?.(page, "detail-card");
      await f.getByRole("button", { name: `Ask about ${first.name}` }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/message")).at(-1), { role: "user", content: [{ type: "text", text: `Tell me more about living in ${first.name} for me` }] });
      await f.getByRole("button", { name: "Open in Borgo" }).click();
      await settle(page, 200);
      const url = await lastLink(page);
      assert.ok(url.startsWith(BORGO_ORIGIN + "/#share="));
      const site = await siteOpens(url);
      assert.deepEqual(site.cities, [first.id], "the site opens exactly that city");
      assert.equal(site.profile.displayCurrency, "EUR");
      assert.deepEqual(site.profile.weights, result._meta.borgo.share.weights, "with the weights the ranking used");
      assert.ok(!JSON.stringify(site.profile.income).includes("80000"), "no pay in the link");
      await done(page);
    },
  },
  {
    name: "selection: Add to comparison and the checkboxes on the rows feed Compare in chat and Open these in Borgo",
    async run(env) {
      const { page, result } = await ranked(env, RANK);
      const f = page.frame;
      const [a, b, c] = result.structuredContent.rows;
      assert.equal(await f.locator(".vrows li input[type=checkbox]").count(), 5, "the checkboxes sit on the bar rows");
      assert.equal(await f.locator("table.rank-table").evaluate((t: HTMLElement) => !!t.closest("details:not([open])")), true, "the table is only in the closed fold");
      await f.locator(".vrows .city-btn").first().click();
      await f.getByRole("button", { name: "Add to comparison" }).click();
      assert.equal(await f.locator(".selection").count(), 1);
      assert.ok((await text(f.locator(".selection"))).includes("1 selected"));
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
      const site = await siteOpens(await lastLink(page));
      assert.deepEqual(site.cities, [a.id, b.id, c.id], "the site opens all of them, in the order picked");
      await f.getByRole("button", { name: "Clear" }).click();
      assert.equal(await f.locator(".selection").count(), 0);
      await done(page);
    },
  },
  {
    name: "compact: one source line when every row shares it, none repeated per row",
    async run(env) {
      const { page, result } = await ranked(env, NICE);
      const f = page.frame;
      assert.equal(await f.locator(".vsrc").count(), 1);
      assert.ok((await text(f.locator(".vsrc"))).startsWith("Source: Open-Meteo"));
      assert.equal(await f.locator(".vrows .mr-cite").count(), 0, "no source under each row");
      assert.equal(await f.locator(".vsub").count(), 1);
      assert.equal(await text(f.locator(".vsub")), `Top 5 of ${result.structuredContent.coverage.matched} known cities · highest first`);
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
    name: "map: the land is coloured by months in range, every placed label clears the others, and a dot opens the card",
    async run(env) {
      const { page, result } = await ranked(env, { ...WORLD, limit: 10 });
      const f = page.frame;
      const rows = result.structuredContent.rows;
      assert.ok(await f.locator(".world-view g.land path").count() >= 5, "land in several shades");
      assert.equal(await f.locator(".city-dot").count(), 10);
      await settle(page, 400);
      const boxes = await f.locator(".world-view text.lbl").evaluateAll((els: SVGTextElement[]) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, e.textContent]; }));
      assert.ok(boxes.length >= 6, `${boxes.length} labels`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        assert.ok(!(a[0] < b[2] - 0.5 && a[2] > b[0] + 0.5 && a[1] < b[3] - 0.5 && a[3] > b[1] + 0.5), `${a[4]} and ${b[4]} overlap`);
      }
      assert.ok(boxes.some((b: any) => String(b[4]).includes(rows[0].name.toUpperCase()) || String(b[4]).includes(rows[0].name)), "the best city is named");
      await env.shot?.(page, "map-labels");
      // The land follows the range at once; this ranking does not count nice days, so nothing is asked of the server.
      const land = await f.locator(".world-view g.land").innerHTML();
      await f.locator('[data-act="nice"]').click();
      await f.getByRole("button", { name: "Coolest nice daytime temperature colder" }).click();
      await settle(page, 900);
      assert.notEqual(await f.locator(".world-view g.land").innerHTML(), land, "the land is coloured again");
      assert.ok((await text(f.locator(".vlegend"))).includes("17–30 °C"));
      assert.equal((await toolCalls(page)).length, 0, "no tool call");
      const [a, b] = rows;
      await f.locator(`.city-dot[data-open="${a.id}"]`).click({ force: true });
      await f.locator(".card h3").waitFor();
      assert.equal(await text(f.locator(".card h3")), a.name);
      await f.locator(`.city-dot[data-open="${b.id}"]`).focus();
      await page.page.keyboard.press("Enter");
      await settle(page, 800);
      assert.equal(await text(f.locator(".card h3")), b.name);
      assert.equal(await f.locator(".city-dot").first().getAttribute("role"), "button");
      await done(page);
    },
  },
  {
    name: "city dossier: get_city draws the city's figures with their sources and its year, and the range redraws it in the frame",
    async run(env) {
      const { page, result } = await opened(env, "get_city", CITY);
      const f = page.frame;
      const r = result.structuredContent;
      assert.equal(await text(f.locator(".dsheet .dname")), r.city.name);
      assert.ok(await f.locator(".dcells .fig").count() >= 5);
      assert.ok((await f.locator(".dcells .cite").allTextContents()).every((c: string) => c.trim().length > 0), "every key figure names its source");
      const feels = r.figures.find((x: any) => x.metric === "feels_high").value as number[];
      let c = comfortOf(CITY, result._meta.borgo.share);
      assert.equal(await f.locator(".dclim .mb.in").count(), inRange(feels, c));
      await f.locator('[data-act="nice"]').click();
      for (let i = 0; i < 3; i++) await f.getByRole("button", { name: "Warmest nice daytime temperature colder" }).click();
      c = nextComfort(nextComfort(nextComfort(c, { step: "max", d: -1 }), { step: "max", d: -1 }), { step: "max", d: -1 });
      await settle(page, 300);
      assert.equal(await f.locator(".dclim .mb.in").count(), inRange(feels, c), "olive months follow the range");
      assert.equal((await toolCalls(page)).length, 0, "the chart is redrawn here, nothing asked");
      await f.getByRole("button", { name: `Ask about ${r.city.name}` }).click();
      await settle(page, 200);
      assert.deepEqual((await page.calls("ui/message")).at(-1), { role: "user", content: [{ type: "text", text: `Tell me more about living in ${r.city.name} for me` }] });
      await f.getByRole("button", { name: "Open in Borgo" }).click();
      await settle(page, 200);
      assert.deepEqual((await siteOpens(await lastLink(page))).cities, [r.city.id]);
      await f.locator('[data-act="nice"]').click();
      await env.shot?.(page, "city-dossier");
      await done(page);
    },
  },
  {
    name: "compare: the default result draws the standings, the points of every line and the fold's table",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      assert.equal(await f.locator(".vstand > li").count(), 3);
      assert.equal(await f.locator(".compare-table tbody tr").count(), 3, "the full table, in the fold");
      assert.equal(await f.locator(".vl-row:not(.is-head)").count(), result.structuredContent.lines.length);
      assert.ok(!(await f.locator("#app").innerText()).includes("Could not draw"));
      assert.ok((await f.locator("#app").innerText()).includes(result.structuredContent.verdict));
      await done(page);
      // detail "full" returns the full report: it draws too, with the same sliders.
      const full = await compared(env, { ...COMPARE, detail: "full" });
      assert.equal(await text(full.page.frame.locator("h2").first()), "Lisbon, Torino and Berlin");
      assert.ok(await full.page.frame.locator("input[type=range]").count() > 5);
      assert.ok(!(await full.page.frame.locator("#app").innerText()).includes("Could not draw"));
      await done(full.page);
    },
  },
  {
    name: "compare: wins and losses open per city, with the points against the others and the figures",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const cmp = comparison(result.structuredContent);
      const { by } = winsLosses(cmp);
      const [first, second] = cmp.cities;
      assert.equal(await f.locator(".cr-wl").count(), 1, "the leader's are open to start");
      assert.deepEqual(await f.locator(".cr-wl .win .wl-n").allTextContents(), by.get(first!.id)!.wins.map((x) => x.label));
      await f.locator(`[data-act="why"][data-city="${second!.id}"]`).click();
      assert.equal(await f.locator(`[data-act="why"][data-city="${second!.id}"]`).getAttribute("aria-expanded"), "true");
      assert.equal(await f.locator(".cr-wl").count(), 2);
      const loses = await f.locator(`#wl-${second!.id} .loss .wl-n`).allTextContents();
      assert.deepEqual(loses, by.get(second!.id)!.losses.map((x) => x.label));
      const d = await f.locator(`#wl-${second!.id} .wl-d`).allTextContents();
      assert.ok(d.every((x: string) => /^[+−]\d/.test(x)), "each with its signed points");
      await env.shot?.(page, "compare-wins");
      await done(page);
    },
  },
  {
    name: "compare: Money, Weather and Map draw in place; Weather and Map ask rank_cities for exactly these cities",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const ids = COMPARE.cities;
      await f.getByRole("radio", { name: "Money" }).click();
      assert.equal(await f.locator(".mcard").count(), 3);
      const lefts = await f.locator(".mcard .wf-sum td.num").allTextContents();
      assert.deepEqual(lefts, result.structuredContent.cities.map((c: any) => money(c.money.leftMonth, "EUR")), "money left, as the server worked it out");
      const first = result.structuredContent.cities[0];
      const lines = await f.locator(".mcard").first().locator("tbody th").allTextContents();
      assert.deepEqual(lines, ["Take-home pay", "Rent", "Everyday spending", "Health", "Left a month"]);
      // Each line is rounded to the euro on its own, so the sum may differ from the rounded total by one.
      assert.ok(Math.abs(first.money.takeHomeMonth - first.money.costs.rent - first.money.costs.everyday - first.money.costs.health - first.money.leftMonth) <= 1, "the lines add up");
      await env.shot?.(page, "money-waterfall");
      assert.equal((await toolCalls(page)).length, 0, "money needs no call");
      await f.getByRole("radio", { name: "Weather" }).click();
      await settle(page, 900);
      assert.deepEqual((await toolCalls(page, "rank_cities")).at(-1), { name: "rank_cities", arguments: { cities: ids, criterion: "nice_days", view: "months", limit: 3 } });
      assert.equal(await f.locator(".nm").count(), 36);
      await f.getByRole("radio", { name: "Map" }).click();
      await settle(page, 900);
      assert.deepEqual((await toolCalls(page, "rank_cities")).at(-1), { name: "rank_cities", arguments: { salary: COMPARE.salary, spending: COMPARE.spending, cities: ids, score: true, view: "world", limit: 3 } });
      assert.equal(await f.locator(".city-dot").count(), 3);
      assert.equal(await f.locator(".world-view text.lbl").count(), 3, "every compared city is named on the map");
      await env.shot?.(page, "compare-map");
      assert.equal((await page.calls("ui/message")).length, 0, "no model turn");
      await done(page);
    },
  },
  {
    name: "compare: a slider re-scores in the frame through compare_cities, with every weight carried",
    async run(env) {
      const { page, result } = await compared(env, COMPARE);
      const f = page.frame;
      const lines = result.structuredContent.lines as { id: string; weight: number }[];
      const scores = () => f.locator(".compare-table tbody tr td:nth-child(3)").allTextContents();
      assert.equal(await f.locator("input[type=range]").count(), lines.length);
      const was = await scores();
      await f.locator('input[data-w="money_left"]').fill("80");
      await settle(page, 1500);
      const call = (await toolCalls(page, "compare_cities")).at(-1)!;
      assert.deepEqual(call.arguments, { ...COMPARE, weights: Object.fromEntries(lines.map((l) => [l.id, l.id === "money_left" ? 80 : l.weight])) });
      const direct: any = await env.server.call("compare_cities", call.arguments);
      const now = await scores();
      assert.deepEqual(now, direct.structuredContent.ranking.map((r: any) => r.total.toFixed(1)), "the frame shows what the server worked out");
      assert.notDeepEqual(now, was, "the scores moved");
      assert.equal(await f.locator('input[data-w="money_left"]').inputValue(), "80");
      assert.equal((await page.calls("ui/message")).length, 0, "no model turn");
      await env.shot?.(page, "compare-sliders");
      await f.getByRole("button", { name: "Reset to the first answer" }).click();
      await settle(page, 1500);
      assert.equal(await f.locator('input[data-w="money_left"]').inputValue(), String(lines[0]!.weight));
      assert.deepEqual(await scores(), was);
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
      const site = await siteOpens(await lastLink(page));
      assert.deepEqual(site.cities, COMPARE.cities);
      assert.equal(site.profile.weights.safety, safety + 2, "the link carries the weights on screen");
      await f.locator(".vstand .city-btn").first().click();
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      const lead = result.structuredContent.ranking[0];
      assert.equal((await toolCalls(page, "get_city")).at(-1)!.arguments.city, lead.id);
      assert.deepEqual(await names(f.locator(".card button")), [`Close ${lead.name} details`, "Open in Borgo", `Ask about ${lead.name}`]);
      assert.equal(await f.locator(".card .dmoney .wf").count(), 1, "the card carries the city's money, since pay was given");
      await done(page);
    },
  },
  {
    name: "take-home pay: net_pay draws the waterfall from gross to take-home",
    async run(env) {
      const { page, result } = await opened(env, "net_pay", PAY);
      const f = page.frame;
      const r = result.structuredContent;
      assert.deepEqual(await f.locator(".wf tbody th").allTextContents(), ["Gross pay a year", ...r.lines.map((l: any) => l.label), "Take-home a year"]);
      assert.equal(await text(f.locator(".wf-sum td.num")), money(r.net, r.currency));
      assert.equal(await f.locator("#app button, #app select, #app input").count(), 0, "nothing to press");
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
    name: "hidden capabilities: a host that lists nothing gets every piece, no controls and no buttons",
    async run(env) {
      for (const [args, name] of [[RANK, "ranked"], [WORLD, "world"], [MONTHS, "months"]] as const) {
        const { page } = await ranked(env, args, BARE_HOST);
        const f = page.frame;
        assert.equal(await f.locator("#app button, #app select, #app input, #app [data-open]").count(), 0, `${name}: nothing to click`);
        assert.equal(await f.locator("a[data-borgo-link]").count(), 1, `${name}: the plain link to Borgo stays`);
        await done(page);
      }
      const c = await compared(env, COMPARE, BARE_HOST);
      assert.equal(await c.page.frame.locator("#app button, #app input, #app select").count(), 0);
      assert.equal(await c.page.frame.locator(".mcard").count(), 3, "the money is drawn under the scores");
      assert.equal(await c.page.frame.locator(".cr-wl").count(), 1, "the leader's wins and losses are shown");
      await done(c.page);
      for (const [tool, args] of [["get_city", CITY], ["net_pay", PAY]] as const) {
        const o = await opened(env, tool, args, BARE_HOST);
        assert.equal(await o.page.frame.locator("#app button, #app input, #app select").count(), 0, `${tool}: nothing to click`);
        await done(o.page);
      }
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
      await only({ serverTools: {} }, async (o, rows) => {
        const f = o.frame;
        assert.equal(await f.locator(".vctl select").count(), 4, "re-query controls");
        assert.equal(await f.locator('.vctl [role="radio"]').count(), 2, "bars or map");
        assert.equal(await f.locator("[type=checkbox]").count(), 0, "nothing to do with a selection");
        await f.locator(".vrows .city-btn").first().click();
        await f.locator(".card h3").waitFor();
        await settle(o, 800);
        assert.deepEqual(await names(f.locator(".card button")), [`Close ${rows[0]} details`], "no way to open, ask or add");
        assert.ok((await f.locator(".card .fig").count()) >= 3);
        assert.equal(await f.locator(".city-dot").count(), 0);
      });
      await only({ openLinks: {} }, async (o, rows) => {
        const f = o.frame;
        assert.equal(await f.locator(".vctl").count(), 0, "cannot ask the server again");
        await f.locator(".vrows .city-btn").first().click();
        assert.deepEqual(await names(f.locator(".card button")), [`Close ${rows[0]} details`, "Open in Borgo", "Add to comparison"]);
        assert.equal((await toolCalls(o)).length, 0, "no tool calls without serverTools");
        await f.getByRole("checkbox", { name: `Select ${rows[1]}` }).check();
        await f.getByRole("button", { name: "Add to comparison" }).click();
        assert.deepEqual(await f.locator(".selection button").allTextContents(), ["Open these in Borgo", "Clear"]);
      });
      await only({ message: { text: {} } }, async (o, rows) => {
        const f = o.frame;
        assert.equal(await f.locator(".vctl").count(), 0);
        await f.locator(".vrows .city-btn").first().click();
        assert.deepEqual(await names(f.locator(".card button")), [`Close ${rows[0]} details`, `Ask about ${rows[0]}`, "Add to comparison"]);
        await f.getByRole("checkbox", { name: `Select ${rows[1]}` }).check();
        await f.getByRole("button", { name: "Add to comparison" }).click();
        assert.deepEqual(await f.locator(".selection button").allTextContents(), ["Compare in chat", "Clear"]);
      });
      await only({ message: { image: {} } }, async (o) => {
        assert.equal(await o.frame.locator("#app button, #app input, #app select, #app [data-open]").count(), 0, "a host that takes no text is not offered messages");
      });
      await only({ serverTools: {}, updateModelContext: { text: {} } }, async (o, rows) => {
        await o.frame.locator('select[data-ctl="limit"]').selectOption("10");
        await settle(o, 1500);
        const sent = (await o.calls("ui/update-model-context")).at(-1);
        assert.ok(sent.content[0].text.includes(rows[0]));
        assert.equal(sent.structuredContent, undefined, "only the kinds of content the host lists");
      });
      await only({ serverTools: {} }, async (o) => {
        await o.frame.locator('select[data-ctl="limit"]').selectOption("10");
        await settle(o, 1200);
        assert.equal((await o.calls("ui/update-model-context")).length, 0, "no context call to a host that does not take it");
      });
      // Weather and Map ask the server: without serverTools a comparison offers Scores and Money only.
      const c = await compared(env, COMPARE, { capabilities: { openLinks: {} } });
      assert.deepEqual(await c.page.frame.locator('[data-act="tab"]').allTextContents(), ["Scores", "Money"]);
      assert.equal(await c.page.frame.locator("input[type=range]").count(), 0, "no sliders without serverTools");
      await done(c.page);
    },
  },
  {
    name: "hidden capabilities: with no way to know the arguments, re-ranking is hidden; tool-input is the fallback",
    async run(env) {
      const none = await ranked(env, RANK, FULL_HOST, { withMeta: false, withInput: false });
      assert.equal(await none.page.frame.locator(".vctl").count(), 0, "no query: no controls");
      assert.ok(await none.page.frame.locator(".vrows .city-btn").count() > 0, "rows still open");
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
      assert.ok((await text(page.frame.locator('[data-k="status"]'))).startsWith("Could not update"));
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
    name: "access: every target is at least 44px, focus moves to the card and back, controls are named",
    async run(env) {
      /** Each control answers a press 21px either side of its middle, across and down: a 44px target. */
      const small = (f: any) => f.locator("#app").evaluate((app: HTMLElement) => {
        const bad: string[] = [];
        for (const el of app.querySelectorAll<HTMLElement>("button, select, .vtick, [role=button], summary")) {
          if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") continue;
          const r = el.getBoundingClientRect();
          if (!r.width) continue;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          for (const [x, y] of [[cx, cy - 21], [cx, cy + 21], [cx - 21, cy], [cx + 21, cy]]) {
            const hit = document.elementFromPoint(x!, y!);
            if (!hit || !(el === hit || el.contains(hit) || (el.tagName === "SELECT" && hit === el.parentElement) || (el.closest("label") && el.closest("label")!.contains(hit)))) { bad.push((el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) + ` at ${Math.round(x! - cx)},${Math.round(y! - cy)}`); break; }
          }
        }
        return bad;
      });
      const { page, result } = await ranked(env, NICE);
      const f = page.frame;
      await f.locator('[data-act="nice"]').click();
      assert.deepEqual(await small(f), [], "ranking, with the nice-day editor open");
      for (const label of ["Rank by", "Order", "Region", "Show"]) assert.equal(await f.getByLabel(label, { exact: true }).count(), 1, label);
      assert.equal(await f.getByRole("radiogroup", { name: "Show as" }).count(), 1);
      const row = f.locator(".vrows .city-btn").first();
      await row.focus();
      await page.page.keyboard.press("Enter");
      await f.locator(".card h3").waitFor();
      await settle(page, 800);
      assert.equal(await focused(f), "card");
      assert.equal(await f.locator(".card").getAttribute("aria-labelledby"), "card-title");
      assert.deepEqual(await small(f), [], "the card");
      await page.page.keyboard.press("Escape");
      assert.equal(await f.locator(".card").count(), 0);
      assert.equal(await focused(f), `open:${result.structuredContent.rows[0].id}`, "focus returns to the row");
      assert.equal(await f.locator("[role=status][aria-live=polite]").count(), 1);
      await done(page);
      const c = await compared(env, COMPARE);
      const sliders = await c.page.frame.locator(".slider").evaluateAll((els: HTMLElement[]) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(sliders.every((h: number) => h >= 43.5), "slider rows are 44px");
      assert.equal(await c.page.frame.locator("input[type=range][aria-valuetext]").count(), sliders.length);
      assert.deepEqual(await small(c.page.frame), [], "comparison");
      await done(c.page);
    },
  },
  {
    name: "look: the site's fonts load from the view's own bytes under the host's default CSP, in the site's colours",
    async run(env) {
      const { page } = await ranked(env, NICE);
      const f = page.frame;
      const faces = await f.locator("html").evaluate(async () => { await document.fonts.ready; return [...(document.fonts as any)].map((x: FontFace) => `${x.family.replace(/"/g, "")} ${x.weight} ${x.status}`).sort(); });
      assert.deepEqual(faces, ["Bib 600 loaded", "Bib 700 loaded", "UI 400 700 loaded"]);
      assert.ok(await f.locator("html").evaluate(() => document.fonts.check('700 26px Bib') && document.fonts.check('400 14px UI')));
      const look = await f.locator(".vtitle").evaluate((e: HTMLElement) => { const s = getComputedStyle(e); return [s.fontFamily.split(",")[0]!.replace(/"/g, ""), s.textTransform, s.fontWeight]; });
      assert.deepEqual(look, ["Bib", "uppercase", "700"]);
      const ground = await f.locator("html").evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);
      assert.equal(ground, env.theme === "dark" ? "rgb(18, 17, 16)" : "rgb(239, 236, 227)", "the site's wall");
      const sheet = await f.locator(".sheet").first().evaluate((e: HTMLElement) => getComputedStyle(e).backgroundColor);
      assert.equal(sheet, env.theme === "dark" ? "rgb(30, 28, 25)" : "rgb(255, 255, 255)", "the site's sheet");
      // The control: the same policy refuses a font from a data: address, which is why the view does not use one.
      const control = await f.locator("html").evaluate(async () => {
        try { await new FontFace("Probe", "url(data:font/woff2;base64,d09GMgABAAAAAA)").load(); return "loaded"; } catch { return "refused"; }
      });
      assert.equal(control, "refused");
      assert.ok((await f.locator("html").evaluate(() => (window as any).__violations.splice(0))).some((v: string) => v.startsWith("font-src")), "the stub's CSP is in force");
      await done(page);
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
      await page.frame.locator(".vrows .city-btn").first().click();
      await settle(page, 600);
      assert.equal(await page.frame.locator("#app img, #app script, #app a[href^=javascript]").count(), 0);
      assert.ok((await page.frame.locator("#app").textContent()).includes("<img src=x"));
      assert.equal(await page.page.evaluate(() => (window as any).pwned), undefined);
      await done(page);
    },
  },
];

export { BARE_HOST, FULL_HOST };
export const DATA = () => loadDataset();
