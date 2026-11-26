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
    for (const name of ["rank_cities", "compare_cities", "get_city"]) {
      const ui = (tools.find((t) => t.name === name)!._meta as any).ui;
      assert.equal(ui.resourceUri, VIEW_URI, `${name} is drawn by the view`);
      assert.deepEqual(ui.visibility, ["model", "app"], `${name} is callable by the view`);
    }
    // Take-home pay is drawn by the view (its waterfall) but never called by it.
    assert.deepEqual((tools.find((t) => t.name === "net_pay")!._meta as any).ui, { resourceUri: VIEW_URI, visibility: ["model"] });
    // No other tool is opened to the view, and the person's data tools stay the model's.
    assert.deepEqual(tools.filter((t) => (t._meta as any)?.ui).map((t) => t.name).sort(), ["compare_cities", "get_city", "net_pay", "rank_cities"]);
    assert.deepEqual(tools.filter((t) => (t._meta as any)?.ui?.visibility?.includes("app")).map((t) => t.name).sort(), ["compare_cities", "get_city", "rank_cities"]);
  } finally {
    await h.close();
  }
});

test("the tools say a host with MCP Apps already shows the chart, so the assistant does not draw another", async () => {
  const h = await remoteHarness();
  try {
    const tools = (await h.client.listTools()).tools;
    // Tool descriptions state what a host shows; the guidance for the model (draw nothing more, summarise in words)
    // lives in the server instructions, because directory policy keeps model instructions out of tool descriptions.
    for (const name of ["rank_cities", "compare_cities"]) {
      const d = tools.find((t) => t.name === name)!.description!;
      assert.match(d, /Hosts with MCP Apps show this result as an interactive Borgo chart/);
    }
    for (const name of ["get_city", "net_pay"]) {
      const d = tools.find((t) => t.name === name)!.description!;
      assert.match(d, /Hosts with MCP Apps show this result as Borgo's/);
    }
    for (const t of tools) assert.doesNotMatch(t.description ?? "", /\b(do not|don't|summarise in words|say the (chart|dossier) is)\b/i, `${t.name}: no instruction to the model in its description`);
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
  // The site's fonts (about 90 KB as base64) and the packed land with its monthly highs ride in the document.
  assert.ok(html.length < 400_000, `light: ${html.length} bytes`);
  assert.ok(html.includes("min-height: 44px"));
  assert.ok(!/@font-face/.test(html), "fonts are read from bytes by FontFace, never from a url the host's CSP refuses");
});

test("mcp app: the view never prints a raw nice-day definition (the sources note says it in words)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp/view-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /JSON\.stringify\(r\.definition\)/);
});

test("the view's look is the site's: every lifted component exists in src/ui, and the tokens are the site's own", async () => {
  const { siteStyle, LIFTED, viewCss } = await import("../src/mcp/view-style.ts");
  const { ROOT } = await import("../src/agent/dataset.ts");
  const { MAP_RAMP } = await import("../src/ui/map-scale.ts");
  const s = siteStyle(ROOT);
  assert.deepEqual(LIFTED.filter((l) => !s.matched.has(l)), [], "a renamed site component must be renamed here too");
  assert.equal(s.tokens.get("--wall"), "light-dark(#EFECE3, #121110)");
  assert.equal(s.tokens.get("--sheet"), "light-dark(#FFFFFF, #1E1C19)");
  assert.equal(s.tokens.get("--human"), "#C4552A");
  assert.match(s.tokens.get("--cond")!, /^Bib,/);
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [i, name] of ["--map-lo", "--map-mid", "--map-hi"].entries()) {
    const [light, dark] = s.tokens.get(name)!.match(/#[0-9a-f]{6}/gi)!;
    assert.deepEqual(hex(light!), [...MAP_RAMP.light[i]!], `${name} light is the canvas map's`);
    assert.deepEqual(hex(dark!), [...MAP_RAMP.dark[i]!], `${name} dark is the canvas map's`);
  }
  const css = viewCss(ROOT);
  assert.ok(css.startsWith(":root{color-scheme:light dark;--paper:"));
  assert.ok(!/url\(/.test(css), "nothing to fetch");
  for (const cls of [".pill-btn{", ".seg button", ".range{", ".wl-bar", ".wf-sum", ".nm{", ".mr-go{", ".band{"]) assert.ok(css.includes(cls), cls);
});

test("the packed land answers months in range exactly as the site's grid does", async () => {
  const { packedMap, HIGH_DIGITS, HIGH_FLOOR } = await import("../src/mcp/chart-source.ts");
  const { unpackLand, tileMonths } = await import("../src/mcp/view-draw.ts");
  const { monthsInRange } = await import("../src/core/world-map.ts");
  const { readFileSync } = await import("node:fs");
  const map = JSON.parse(readFileSync(new URL("../public/data/map.json", import.meta.url), "utf8"));
  const packed = { ...packedMap(map), digits: HIGH_DIGITS, floor: HIGH_FLOOR, source: "" };
  const land = unpackLand(packed);
  assert.equal(land.n, map.tiles.length / 3);
  const at = new Map<number, number>();
  for (let i = 0; i < land.n; i++) at.set(land.row[i]! * 1000 + land.col[i]!, i);
  for (const [min, max] of [[18, 30], [10, 22], [25, 35], [-5, 5]]) {
    for (let t = 0; t < map.tiles.length / 3; t++) {
      const j = at.get(map.tiles[t * 3 + 1] * 1000 + map.tiles[t * 3])!;
      assert.equal(land.k[j], map.tiles[t * 3 + 2]);
      if (tileMonths(land, j, min!, max!) !== monthsInRange(map, t, min!, max!)) assert.fail(`tile ${t}, ${min}-${max}`);
    }
  }
});

test("nice days: an edit in the chat changes the definition as the site does", async () => {
  const { comfortOf, nextComfort, testsShort, rangeLabel } = await import("../src/mcp/view-draw.ts");
  const share = shareFor(data, {});
  let c = comfortOf({}, share);
  assert.deepEqual(c, { min: 18, max: 30, basis: "feels" });
  assert.equal(rangeLabel(c), "18–30° feels");
  assert.equal(testsShort(c), "Dry, sunny");
  c = nextComfort(c, { step: "min", d: 13 });
  assert.deepEqual([c.min, c.max], [31, 31], "the range never turns inside out");
  c = nextComfort(c, { step: "max", d: 100 });
  assert.equal(c.max, 45, "45 °C at most");
  c = nextComfort(c, { test: "dry", on: false });
  assert.equal(c.dry, false);
  c = nextComfort(c, { test: "dry", on: true });
  assert.equal("dry" in c, false, "on is the default, so it is not written");
  c = nextComfort(nextComfort(c, { test: "notMuggy", on: true }), { daylight: 12 });
  assert.equal(testsShort(c), "Dry, sunny, not muggy, 12 h of daylight");
  c = nextComfort(c, { daylight: 0 });
  assert.equal("daylight" in c, false);
  assert.deepEqual(comfortOf({ comfort: { min: 20, max: 26, basis: "air", calm: true } }, share), { min: 20, max: 26, basis: "air", calm: true }, "the call's own definition first");
  // The ranking the edit asks for counts nice days by it.
  const a = rankCities(data, { criterion: "nice_days", limit: 3 } as any);
  const b = rankCities(data, { criterion: "nice_days", limit: 3, comfort: { min: 18, max: 30, basis: "feels", clear: false } } as any);
  assert.ok(b.rows[0]!.value > a.rows[0]!.value, "letting cloud through adds nice days");
});

test("labels on the map never overlap one another or a dot, and stay inside the map", async () => {
  const { placeLabels, mapWindow } = await import("../src/mcp/view-draw.ts");
  const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i), x: 100 + (i % 6) * 9, y: 50 + Math.floor(i / 6) * 4, gap: 3, w: 20, h: 3 }));
  const dots = items.map((d) => ({ x: d.x, y: d.y, r: 1.5 }));
  const out = placeLabels(items, [0, 0, 300, 150], dots);
  assert.ok(out.length > 3 && out.length < 30, `${out.length} placed, the rest left out`);
  const box = (p: any) => { const w = 20; const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2; return [x0, p.y - 1.5, x0 + w, p.y + 1.5]; };
  const boxes = out.map(box);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    assert.ok(a[0]! >= 0 && a[2]! <= 300 && a[1]! >= 0 && a[3]! <= 150);
    for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j]!; assert.ok(!(a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!), `${i} and ${j}`); }
    for (const d of dots) assert.ok(!(a[0]! < d.x + d.r && a[2]! > d.x - d.r && a[1]! < d.y + d.r && a[3]! > d.y - d.r), "clear of every dot");
  }
  assert.equal(out[0]!.id, "0", "the best city is placed first");
  const world: [number, number, number, number] = [20, 15, 700, 315];
  assert.deepEqual(mapWindow(world, [[50, 50], [650, 280]]), [16, 11, 688, 308], "spread cities: the whole world");
  const near = mapWindow(world, [[340, 80], [360, 70], [380, 60]]);
  assert.ok(near[2] < 300 && near[0] <= 340 && near[0] + near[2] >= 380, "close cities: a window around them");
});

test("wins and losses: each city against the average of the others on the engine's points", async () => {
  const { comparison, winsLosses } = await import("../src/mcp/view-draw.ts");
  const args = { cities: ["lisbon-pt", "turin-it", "berlin-de"], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR" } };
  const s = summarize(compare(data, args), {}) as any;
  const cmp = comparison(s);
  const { by, scale } = winsLosses(cmp);
  for (const c of s.cities) {
    const e = by.get(c.id)!;
    for (const w of e.wins) {
      const mine = c.lines.find((l: any) => l.id === w.id).points;
      const others = s.cities.filter((o: any) => o.id !== c.id).map((o: any) => o.lines.find((l: any) => l.id === w.id)?.points ?? 0);
      assert.ok(Math.abs(w.d - (mine - others.reduce((a: number, b: number) => a + b, 0) / others.length)) < 1e-9);
      assert.ok(w.d > 0.25 && Math.abs(w.d) <= scale);
    }
    assert.ok(e.losses.every((x) => x.d < -0.25 || x.failing));
    assert.ok(e.wins.length <= 3 && e.losses.length <= 3);
  }
  // The full report reads the same.
  const full = comparison(compare(data, args) as any);
  assert.deepEqual(full.cities.map((c) => c.id), cmp.cities.map((c) => c.id));
  assert.deepEqual(full.lines.map((l) => l.id).sort(), cmp.lines.map((l) => l.id).sort());
});

test("money: the summary says what each month's cost is made of, for the waterfall", () => {
  const s = summarize(compare(data, { cities: ["lisbon-pt", "turin-it"], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 2000, currency: "EUR" } }), {}) as any;
  for (const c of s.cities) {
    const m = c.money;
    assert.equal(m.grossYear, 60000);
    const parts = Object.values(m.costs).reduce((a: number, b: any) => a + (b ?? 0), 0) as number;
    assert.ok(Math.abs(parts - m.costMonth) <= 2, `${c.id}: ${parts} against ${m.costMonth}`);
  }
  const none = summarize(compare(data, { cities: ["lisbon-pt"] }), {}) as any;
  assert.equal(none.cities[0].money, null, "no money block without pay or spending");
});

test("get_city carries what the view needs to open the city on the site, and nothing private", async () => {
  const h = await remoteHarness();
  try {
    const r: any = await h.client.callTool({ name: "get_city", arguments: { city: "Lisbon", passports: [["US"]] } });
    assert.deepEqual(r._meta.borgo.query, { city: "Lisbon", passports: [["US"]] });
    assert.deepEqual(r._meta.borgo.share, shareFor(data, { cities: ["lisbon-pt"] }));
    assert.ok(!JSON.stringify(r._meta.borgo.share).includes('"US"'));
  } finally {
    await h.close();
  }
});
