// What a comparison page says to a search for "A vs B", "cost of living A vs B" or "moving from A to B", how the
// pages link to each other so a crawler reaches every one, and the sitemap's lastmod.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { datePages, pageHash, prerender, type Manifest } from "../scripts/prerender.ts";
import { SITE_ORIGIN } from "../scripts/site.ts";
import type { Dataset } from "../src/core/types.ts";
import { compareFacts, comparisonPairs } from "../src/site/facts.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { money as fmtMoney } from "../src/ui/format.ts";

const ROOT = join(import.meta.dirname, "..");
const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const pairs = comparisonPairs(data);
const dist = mkdtempSync(join(tmpdir(), "borgo-intent-"));
let manifest: Manifest;
const read = (rel: string) => readFileSync(join(dist, rel), "utf8");
const unesc = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const meta = (page: string) => ({
  title: unesc(page.match(/<title>([^<]*)<\/title>/)![1]!),
  description: unesc(page.match(/<meta name="description" content="([^"]*)"/)![1]!),
  h1: unesc(page.match(/<h1>([^<]*)<\/h1>/)![1]!),
  lede: unesc(page.match(/<p class="lede">([\s\S]*?)<\/p>/)![1]!.replace(/<[^>]+>/g, "")),
});

const APP = `<!doctype html><html><head><title>app</title></head><body><div class="site"><div id="page"></div>\n</div>\n<aside id="sheet" hidden></aside></body></html>`;

before(async () => {
  writeFileSync(join(dist, "index.html"), APP);
  cpSync(join(ROOT, "public/data"), join(dist, "data"), { recursive: true });
  manifest = await prerender(dist, data, { today: "2026-11-15" });
});

after(() => rmSync(dist, { recursive: true, force: true }));

test("a comparison's title, H1 and opening answer 'A vs B' and 'cost of living A vs B' with the pair's own numbers", () => {
  const c = compareFacts(data, "bristol-gb", "edinburgh-gb", pairs);
  const m = meta(read("compare/bristol-gb-vs-edinburgh-gb/index.html"));
  assert.match(m.title, /^Bristol vs Edinburgh: cost of living, take-home pay and weather/);
  assert.match(m.h1, /^Bristol vs Edinburgh: cost of living/);
  // Both cities share pounds, so the numbers are in pounds; the take-home figures are the page's own.
  assert.equal(c.intent.currency, "GBP");
  for (const v of [c.intent.a.takeHome!, c.intent.b.takeHome!]) {
    assert.ok(m.description.includes(fmtMoney(v, "GBP")), `description lacks ${fmtMoney(v, "GBP")}`);
    assert.ok(m.lede.includes(fmtMoney(v, "GBP")), `lede lacks ${fmtMoney(v, "GBP")}`);
  }
  // Both cities have an official rent (ONS for Bristol, the Scottish Government for Edinburgh): both are set side by side.
  assert.ok(c.intent.a.rent !== null && c.intent.b.rent !== null);
  assert.ok(m.description.includes(`One-bedroom rent: ${fmtMoney(c.intent.a.rent!, "GBP")} vs ${fmtMoney(c.intent.b.rent!, "GBP")}`), m.description);
  // ONS counts every tenancy, so Bristol's rent says newcomers pay more; Edinburgh's (homes let that year) does not.
  assert.match(m.lede, /A one-bedroom home rents for about £[\d,]+ a month in Bristol \(all tenancies; newcomers usually pay more\) and £[\d,]+ in Edinburgh\./);
  assert.match(m.lede, /nice days a year/);
});

test("a city without an open rent figure is said to have none, and the description never sets a rent beside nothing", () => {
  const c = compareFacts(data, "athens-gr", "malaga-es", pairs);
  const m = meta(read("compare/athens-gr-vs-malaga-es/index.html"));
  assert.ok(c.intent.b.rent !== null, "Málaga has the SERPAVI rent");
  assert.equal(c.intent.a.rent, null);
  assert.match(m.lede, /Athens has no open rent figure yet/);
  assert.ok(!/rent/i.test(m.description), m.description);
});

test("cities in different currencies are compared in euros; the take-home numbers match the money table", () => {
  const c = compareFacts(data, "montreal-ca", "new-york-us", pairs);
  assert.equal(c.intent.currency, "EUR");
  const [ra] = c.results;
  assert.equal(Math.round(c.intent.a.takeHome!), Math.round(ra.money.display.net! / 12));
  assert.ok(c.intent.a.rent !== null && c.intent.b.rent !== null);
  assert.match(c.intent.description, /One-bedroom rent: €[\d,]+ vs €[\d,]+/);
});

test("'moving from A to B' and 'from B to A' are both answered on the one page, with differences that mirror", () => {
  const c = compareFacts(data, "bristol-gb", "edinburgh-gb", pairs);
  assert.ok(c.intent.moving);
  const [ab, ba] = c.intent.moving!;
  assert.match(ab, /^Moving from Bristol to Edinburgh/);
  assert.match(ba, /^Moving from Edinburgh to Bristol/);
  const d = Math.abs(c.intent.a.takeHome! - c.intent.b.takeHome!);
  const said = fmtMoney(d, "GBP");
  assert.ok(ab.includes(`${said} less`) && ba.includes(`${said} more`), `${ab} / ${ba}`);
  const page = read("compare/bristol-gb-vs-edinburgh-gb/index.html");
  assert.ok(page.includes("<h2>Moving between Bristol and Edinburgh</h2>"));
  // Across a border, the page says whether a citizen of the first country needs a visa in the second.
  const x = compareFacts(data, "dubai-ae", "singapore-sg", pairs);
  assert.match(x.intent.moving![0], /citizen of the United Arab Emirates needs a visa or permit/);
});

test("every comparison has its own title and a description of at most 160 characters that carries a number", () => {
  const seen = new Set<string>();
  for (const [a, b] of pairs) {
    const m = meta(read(`compare/${a}-vs-${b}/index.html`));
    assert.ok(!seen.has(m.description), `duplicate description ${m.description}`);
    seen.add(m.description);
    assert.ok(m.description.length <= 160, m.description);
    assert.match(m.description, /\d/, `no number in the description of ${a} vs ${b}`);
    for (const t of [m.title, m.description, m.lede]) assert.ok(!t.includes("\u2014"), `em dash in ${t}`);
  }
});

test("every comparison links to every other comparison of its two cities, and each is reached from several pages", () => {
  const inbound = new Map<string, number>();
  for (const p of manifest.pages) {
    const page = read(`${p.slice(1)}index.html`);
    for (const m of page.matchAll(/href="(?:\.\.\/)*compare\/([a-z0-9-]+-vs-[a-z0-9-]+)\/"/g)) inbound.set(m[1]!, (inbound.get(m[1]!) ?? 0) + 1);
  }
  for (const [a, b] of pairs) {
    const page = read(`compare/${a}-vs-${b}/index.html`);
    for (const [x, y] of pairs.filter(([x, y]) => (x === a || y === a || x === b || y === b) && !(x === a && y === b)))
      assert.ok(page.includes(`href="../../compare/${x}-vs-${y}/"`), `${a}-vs-${b} does not link ${x}-vs-${y}`);
    assert.ok((inbound.get(`${a}-vs-${b}`) ?? 0) >= 5, `${a}-vs-${b} is linked from only ${inbound.get(`${a}-vs-${b}`)} pages`);
  }
  // The hub lists each pair under both of its cities.
  const hub = read("compare/index.html");
  for (const [a, b] of pairs) assert.equal(hub.split(`href="${a}-vs-${b}/"`).length - 1, 2, `${a}-vs-${b} on the hub`);
});

test("llms.txt names work by kind, the quality-of-life index and community figures, and links the work doc it publishes", () => {
  const txt = read("llms.txt");
  assert.match(txt, /^## Work and quality of life$/m);
  assert.match(txt, /--work software/);
  assert.match(txt, /qualityOfLife/);
  assert.match(txt, /quality-of-life index \d+ of 100/);
  assert.match(txt, /^## Community figures \(live\)$/m);
  assert.ok(txt.includes(`${SITE_ORIGIN}/docs/work.md`));
  assert.ok(read("docs/work.md").startsWith("# Work and ambition"));
});

test("lastmod is the day a page's content last changed", () => {
  assert.deepEqual(
    datePages({ "/a/": { hash: "1", lastmod: "2026-11-01" }, "/b/": { hash: "2", lastmod: "2026-11-01" }, "/gone/": { hash: "3", lastmod: "2026-11-01" } }, { "/a/": "1", "/b/": "changed", "/new/": "4" }, "2026-11-15"),
    { "/a/": { hash: "1", lastmod: "2026-11-01" }, "/b/": { hash: "changed", lastmod: "2026-11-15" }, "/new/": { hash: "4", lastmod: "2026-11-15" } },
  );
  assert.equal(pageHash("a", "b"), pageHash("a", "b"));
  assert.notEqual(pageHash("a", "b"), pageHash("ab", ""));
  // Without earlier dates every page is new today; with them, an unchanged page keeps its day in the sitemap.
  const lastmods = [...read("sitemap.xml").matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.ok(lastmods.length === manifest.pages.length && lastmods.every((d) => d === "2026-11-15"));
});

test("an unchanged page keeps its earlier lastmod on the next build", async () => {
  const again = mkdtempSync(join(tmpdir(), "borgo-intent-2-"));
  try {
    writeFileSync(join(again, "index.html"), APP);
    cpSync(join(ROOT, "public/data"), join(again, "data"), { recursive: true });
    const earlier = Object.fromEntries(Object.entries(manifest.dates).map(([p, d]) => [p, { ...d, lastmod: "2026-11-01" }]));
    earlier["/cities/"] = { hash: "stale", lastmod: "2026-11-01" };
    const m2 = await prerender(again, data, { dates: earlier, today: "2026-11-20" });
    assert.equal(m2.dates["/compare/bristol-gb-vs-edinburgh-gb/"]!.lastmod, "2026-11-01");
    assert.equal(m2.dates["/cities/"]!.lastmod, "2026-11-20");
    assert.match(readFileSync(join(again, "sitemap.xml"), "utf8"), new RegExp(`<loc>${SITE_ORIGIN}/cities/</loc><lastmod>2026-11-20</lastmod>`));
  } finally {
    rmSync(again, { recursive: true, force: true });
  }
});
