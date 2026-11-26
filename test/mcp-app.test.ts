// The MCP App's interactive layer without a browser: what the tools declare, what they hand the view, the links the view
// builds and what the site makes of them, the ranking choices it offers, and the view document's shape. The view's clicks
// in a browser are test/mcp-app-browser.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/agent/dataset.ts";
import { chartInput, compareSvg, summaryChartInput } from "../src/agent/chart.ts";
import { rankCities } from "../src/agent/rank.ts";
import { shareLink } from "../src/agent/share-link.ts";
import { sharedPart, shareFor } from "../src/agent/share.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { compare, summarize } from "../src/agent/report.ts";
import { CRITERIA } from "../src/core/criteria.ts";
import { INSTRUCTIONS } from "../src/mcp/tools.ts";
import { CARD_METRICS, LIMIT_CHOICES, LOWER_IS_BETTER, MONTHLY, measures, REGION_CHOICES } from "../src/mcp/measures.ts";
import { APPS_PROTOCOL, VIEW_URI, viewHtml } from "../src/mcp/view.ts";
import { sharedProfile } from "../src/ui/state.ts";
import { remoteHarness } from "./mcp-harness.ts";
import { siteOpens } from "./site-reader.ts";

const data = loadDataset();
const PAY = { salary: { amount: 80000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR", homeCity: "lisbon-pt" }, household: [{ passports: ["IT"] }], work: "software" };

test("rank_cities and compare_cities are shown by the view and callable by it; get_city is callable by it", async () => {
  const h = await remoteHarness();
  try {
    const tools = (await h.client.listTools()).tools;
    for (const name of ["rank_cities", "compare_cities"]) {
      const ui = (tools.find((t) => t.name === name)!._meta as any).ui;
      assert.equal(ui.resourceUri, VIEW_URI);
      assert.deepEqual(ui.visibility, ["model", "app"]);
    }
    const city = tools.find((t) => t.name === "get_city")!;
    assert.deepEqual((city._meta as any).ui, { visibility: ["model", "app"] });
    assert.equal((city._meta as any).ui.resourceUri, undefined, "get_city does not draw its own chart");
    // No other tool is opened to the view: it needs three, and the person's data tools stay the model's.
    assert.deepEqual(tools.filter((t) => (t._meta as any)?.ui).map((t) => t.name).sort(), ["compare_cities", "get_city", "rank_cities"]);
  } finally {
    await h.close();
  }
});

test("the tools say a host with MCP Apps already shows the chart, so the assistant does not draw another", async () => {
  const h = await remoteHarness();
  try {
    const tools = (await h.client.listTools()).tools;
    for (const name of ["rank_cities", "compare_cities"]) {
      const d = tools.find((t) => t.name === name)!.description!;
      assert.match(d, /already show this result as an interactive Borgo chart/);
      assert.match(d, /do not draw your own chart or table of it/);
      assert.match(d, /summarise the findings in words/);
    }
    assert.match(INSTRUCTIONS, /do not draw another chart or table/);
    assert.match(INSTRUCTIONS, /do not redraw it/);
    assert.match(INSTRUCTIONS, /Retain the compact table and Borgo link for hosts without Apps/);
  } finally {
    await h.close();
  }
});

test("a result carries the call's arguments and the shareable part of the profile in _meta, not in what the model reads", async () => {
  const h = await remoteHarness();
  try {
    const args = { criterion: "after_tax_rent", ...PAY, limit: 3 };
    const r: any = await h.client.callTool({ name: "rank_cities", arguments: args });
    assert.deepEqual(r._meta.borgo.query, args);
    assert.deepEqual(r._meta.borgo.share, sharedPart(buildProfile(data, { ...args, cities: [data.cities[0]!.id] }).profile));
    assert.equal(r.structuredContent.query, undefined, "the model's copy has no query echo");
    assert.ok(!JSON.stringify(r.content).includes("80000"), "nor does its text");
    const shared = JSON.stringify(r._meta.borgo.share);
    for (const private_ of ["80000", "salary", "IT", "2000", "household", "lisbon-pt", "income", "citizenships"]) assert.ok(!shared.includes(private_ === "IT" ? '"IT"' : private_), `the shared part has no ${private_}`);
    const c: any = await h.client.callTool({ name: "compare_cities", arguments: { cities: ["lisbon-pt", "turin-it"], ...PAY } });
    assert.equal(c._meta.borgo.query.salary.amount, 80000);
    assert.ok(c._meta.borgo.share.weights.money_left > 0);
    const full: any = await h.client.callTool({ name: "compare_cities", arguments: { cities: ["lisbon-pt", "turin-it"], detail: "full" } });
    assert.equal(full._meta.borgo.query.detail, "full");
  } finally {
    await h.close();
  }
});

test("the shared part is exactly what the site's share panel carries with nothing private included", () => {
  for (const args of [{ cities: ["lisbon-pt"] }, { cities: ["lisbon-pt"], ...PAY, weights: { politics: 50, safety: 30 }, stances: { politics: 2 }, personal: [{ label: "Family", scores: { "lisbon-pt": 5 } }], dealBreakers: ["safety", "politics"] }]) {
    const p = buildProfile(data, args).profile;
    const { cities, ...site } = sharedProfile(p, []);
    assert.deepEqual(sharedPart(p), site);
    assert.equal(cities?.length, 1);
  }
  assert.deepEqual(shareFor(data, { work: "software" }).work, "software");
});

test("the site opens exactly the cities and weights a link names, and nothing private", async () => {
  const args = { ...PAY, weights: { safety: 40, clean_air: 25 } };
  const share = shareFor(data, args);
  const picked = [{ id: "turin-it", name: "Turin", country: "IT" }, { id: "lisbon-pt", name: "Lisbon", country: "PT" }];
  const url = shareLink(share as any, picked);
  assert.ok(url.startsWith("https://borgo.abcastor.com/#share="));
  const opened = await siteOpens(url);
  assert.deepEqual(opened.cities, ["turin-it", "lisbon-pt"]);
  assert.equal(opened.profile.weights.safety, 40);
  assert.equal(opened.profile.weights.clean_air, 25);
  assert.equal(opened.profile.displayCurrency, "EUR");
  assert.equal(opened.profile.income.gross, 0);
  assert.equal(opened.profile.income.everyday, null);
  assert.deepEqual(opened.profile.household.map((h) => h.citizenships).flat(), [], "no passports");
  assert.equal(opened.profile.work, "software", "the kind of work shapes the weights, so it travels with them");
  // A place the site's data lacks is named as written, never dropped silently.
  const unknown = await siteOpens(shareLink(share as any, [{ id: "sligo-ie", name: "Sligo", country: "IE" }]));
  assert.deepEqual(unknown.cities, [], "the reader drops what it has no figures for");
  const raw = JSON.parse(Buffer.from(new URL(shareLink(share as any, [{ id: "sligo-ie", name: "Sligo", country: "IE" }])).hash.slice(7), "base64url").toString());
  assert.deepEqual(raw.places, { "sligo-ie": "Sligo, IE" }, "so it can offer to fetch it");
});

test("every ranking the picker offers answers when the person's details allow it, in the order that puts the best first", () => {
  const list = measures();
  assert.ok(list.length >= 45, `${list.length} entries`);
  assert.deepEqual([...new Set(list.map((m) => m.group))].slice(0, 4), ["Money", "Right to live and work", "Weather", "Health"]);
  assert.ok(!list.some((m) => ["politics", "abortion", "couples_law"].includes(String(m.arg.criterion))), "no position lines: they need a stance");
  assert.equal(new Set(list.map((m) => m.key)).size, list.length);
  const ctxs: Record<string, object> = { salary: { salary: PAY.salary }, spending: { salary: PAY.salary, spending: PAY.spending }, home: { spending: PAY.spending }, household: { household: PAY.household }, work: { work: PAY.work } };
  const { profile } = buildProfile(data, { cities: ["lisbon-pt"] });
  for (const m of list) {
    const given = Object.assign({}, ...m.needs.map((n) => (n === "spending" ? ctxs.spending : ctxs[n]!)));
    const r = rankCities(data, { ...m.arg, ...given, order: m.order, limit: 3 } as any);
    assert.ok(r.rows.length > 0, `${m.key} ranks something when its needs are given`);
    assert.equal(r.rows[0]!.value >= r.rows.at(-1)!.value, m.order === "desc" || r.rows.length === 1 || r.rows[0]!.value === r.rows.at(-1)!.value, `${m.key} is ordered ${m.order}`);
    assert.equal(r.rows.some((x) => x.months?.length === 12), m.months, `${m.key} months flag`);
    const c = CRITERIA.find((x) => x.id === m.arg.criterion);
    if (c) {
      const [worst, best] = c.scale(profile, data);
      assert.equal(m.order, best < worst ? "asc" : "desc", `${m.key}: the scale's better end decides the order`);
      assert.equal(LOWER_IS_BETTER.has(c.id), best < worst);
    }
    // Without those details the ranking answers nothing (or refuses), which is why the picker withholds it.
    if (m.needs.length) assert.equal((() => { try { return rankCities(data, { ...m.arg, limit: 3 } as any).rows.length; } catch { return 0; } })(), 0, `${m.key} is withheld without its needs`);
  }
  for (const id of MONTHLY) assert.ok(list.find((m) => m.key === `criterion:${id}`)?.months, id);
  assert.ok(CARD_METRICS.every((id) => data.metrics[id]), "the card's figures exist");
  assert.deepEqual(LIMIT_CHOICES, [5, 10, 20, 50]);
  assert.equal(REGION_CHOICES.length, 5);
});

test("the default compare result (the summary shape) becomes a chart; the view once threw on it", async () => {
  const r = compare(data, { cities: ["lisbon-pt", "turin-it", "berlin-de"], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR" } });
  const summary = summarize(r, {}) as any;
  assert.throws(() => chartInput(summary as any), "the full-report reader cannot read it");
  const input: any = summaryChartInput(summary);
  assert.deepEqual(input.cities.map((c: any) => c.name), summary.cities.map((c: any) => c.name));
  assert.ok(input.cities.every((c: any) => c.lines.length > 0 && c.lines.every((l: any) => l.label && !l.label.includes("("))), "labels are the line names, with no bracketed definitions");
  assert.ok(input.cities.some((c: any) => typeof c.monthlyLeft === "number"));
  const svg = compareSvg(input);
  assert.match(svg, /^<svg /);
  for (const c of input.cities) assert.ok(svg.includes(c.name));
  // The full report still draws through the old path.
  assert.doesNotThrow(() => compareSvg(chartInput(r as any)));
});

test("the view document: protocol, calls it makes, and no way to reach a network", () => {
  const html = viewHtml();
  assert.ok(html.includes(`"protocol":"${APPS_PROTOCOL}"`));
  for (const m of ["ui/initialize", "ui/notifications/initialized", "tools/call", "ui/open-link", "ui/message", "ui/update-model-context", "ui/request-display-mode", "ui/notifications/size-changed", "ui/notifications/tool-result", "ui/notifications/tool-input"]) assert.ok(html.includes(m), m);
  for (const bad of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts", "import(", "window.open", "location.href", "location.assign", "localStorage", "document.cookie"]) assert.ok(!html.includes(bad), `no ${bad}`);
  assert.ok(!/<script[^>]*src=|<link[^>]*href=|<img[^>]*src=https?:|@import|url\(/.test(html.replace(/<script type="module">[\s\S]*<\/script>/, "")), "nothing loads from outside");
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.ok(html.length < 300_000, `light: ${html.length} bytes`);
  assert.ok(html.includes("min-height:44px"));
});

test("mcp app: the view never prints a raw nice-day definition (the sources note says it in words)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp/view-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /JSON\.stringify\(r\.definition\)/);
});
