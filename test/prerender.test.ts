import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { prerender, PUBLIC_DOCS, type Manifest } from "../scripts/prerender.ts";
import { SITE_ORIGIN } from "../scripts/site.ts";
import type { Dataset } from "../src/core/types.ts";
import { cityFacts, comparisonPairs } from "../src/site/facts.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";

const ROOT = join(import.meta.dirname, "..");
const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const dist = mkdtempSync(join(tmpdir(), "wtl-prerender-"));
let manifest: Manifest;

const read = (rel: string) => readFileSync(join(dist, rel), "utf8");
const pageFile = (path: string) => `${path.slice(1)}index.html`;
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jsonLd = (htmlText: string) => [...htmlText.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
const nodes = (ld: any): any[] => (ld["@graph"] ? ld["@graph"] : [ld]);

before(async () => {
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><title>app</title></head><body><div class="site"><div id="page"></div>\n</div>\n<aside id="sheet" hidden></aside></body></html>`);
  cpSync(join(ROOT, "public/data"), join(dist, "data"), { recursive: true }); // as scripts/build.ts does
  manifest = await prerender(dist, data);
});

after(() => rmSync(dist, { recursive: true, force: true }));

test("one page per city, per comparison pair, three hubs and the app", () => {
  const pairs = comparisonPairs(data);
  assert.equal(manifest.pages.length, 1 + 3 + data.cities.length + pairs.length);
  for (const p of manifest.pages) assert.ok(existsSync(join(dist, pageFile(p))), `missing ${p}`);
  for (const c of data.cities) assert.ok(manifest.pages.includes(`/city/${c.id}/`));
  for (const p of manifest.pages) assert.ok(existsSync(join(dist, `${p.slice(1)}index.md`)), `missing markdown twin of ${p}`);
});

test("comparison pairs: each once, in id order, and the obvious rivals are there", () => {
  const pairs = comparisonPairs(data);
  const keys = pairs.map(([a, b]) => `${a}|${b}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const [a, b] of pairs) assert.ok(a < b);
  for (const k of ["dublin-ie|london-gb", "milan-it|turin-it", "amsterdam-nl|berlin-de", "new-york-us|san-francisco-us"]) assert.ok(keys.includes(k), k);
});

test("a city page carries its sourced figures, their sources and licences", () => {
  const f = cityFacts(data, "turin-it");
  const page = read("city/turin-it/index.html");
  assert.ok(f.figures.length >= 5);
  for (const x of f.figures) {
    assert.ok(page.includes(escText(x.text)), `figure ${x.metric} (${x.text}) missing`);
    for (const s of x.sources) {
      assert.ok(page.includes(escText(s.name)), `source ${s.name} missing`);
      assert.ok(page.includes(escText(s.licence)), `licence ${s.licence} missing`);
    }
    assert.ok(page.includes(x.period), `period of ${x.metric} missing`);
  }
  assert.match(page, /What you would take home/);
  assert.match(page, /Who can live and work here freely/);
  assert.match(page, /numbeo\.com/); // link-out only
});

test("every page has a unique title and description, a canonical URL and JSON-LD that parses", () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const p of manifest.pages.filter((x) => x !== "/")) {
    const page = read(pageFile(p));
    const title = page.match(/<title>([^<]*)<\/title>/)![1]!;
    const desc = page.match(/<meta name="description" content="([^"]*)"/)![1]!;
    assert.ok(!titles.has(title), `duplicate title ${title}`);
    assert.ok(!descriptions.has(desc), `duplicate description on ${p}`);
    titles.add(title);
    descriptions.add(desc);
    assert.ok(desc.length <= 160, `description too long on ${p}`);
    assert.ok(page.includes(`<link rel="canonical" href="${SITE_ORIGIN}${p}">`), `canonical on ${p}`);
    assert.ok(page.includes('property="og:image"'));
    const ld = jsonLd(page);
    assert.ok(ld.length >= 1, `no JSON-LD on ${p}`);
  }
});

test("city JSON-LD: a City and a Dataset with licence and creator", () => {
  const all = jsonLd(read("city/london-gb/index.html")).flatMap(nodes);
  const city = all.find((n) => n["@type"] === "City");
  const ds = all.find((n) => n["@type"] === "Dataset");
  assert.equal(city.name, "London");
  assert.ok(ds.license.startsWith("https://creativecommons.org/licenses/by/4.0"));
  assert.ok(ds.creator?.name);
  assert.ok(ds.variableMeasured.length > 0);
});

test("FAQPage only with questions the page shows", () => {
  const page = read("compare/dublin-ie-vs-london-gb/index.html");
  const faq = jsonLd(page).flatMap(nodes).find((n) => n["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.length > 0);
  for (const q of faq.mainEntity) {
    assert.ok(page.includes(`<h3>${escText(q.name)}</h3>`), `question not visible: ${q.name}`);
    assert.ok(page.includes(escText(q.acceptedAnswer.text)), `answer not visible: ${q.name}`);
  }
  assert.ok(!jsonLd(read("city/london-gb/index.html")).flatMap(nodes).some((n) => n["@type"] === "FAQPage"));
});

test("the make-it-yours link opens the app with the pair, keeping the visitor's saved profile", () => {
  const page = read("compare/dublin-ie-vs-london-gb/index.html");
  const q = page.match(/class="make" href="\.\.\/\.\.\/\?([^"]+)"/)![1]!;
  assert.equal(new URLSearchParams(q.replace(/&amp;/g, "&")).get("cities"), "dublin-ie,london-gb");
});

test("sitemap lists every page once, robots.txt welcomes crawlers and points to it", () => {
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  assert.deepEqual(new Set(locs), new Set(manifest.pages.map((p) => `${SITE_ORIGIN}${p}`)));
  assert.equal(locs.length, manifest.pages.length);
  const robots = read("robots.txt");
  assert.match(robots, /User-agent: \*\nAllow: \//);
  for (const bot of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "Googlebot"]) assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`));
  assert.ok(!/Disallow/.test(robots));
  assert.ok(robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
});

test("llms.txt follows the format and its site links resolve", () => {
  const txt = read("llms.txt");
  const lines = txt.split("\n");
  assert.match(lines[0]!, /^# \S/);
  assert.match(lines.find((l, i) => i > 0 && l.trim())!, /^> \S/);
  assert.ok(lines.filter((l) => /^# /.test(l)).length === 1);
  assert.ok(/^## Cities$/m.test(txt) && /^## Optional$/m.test(txt));
  for (const l of lines.filter((x) => x.startsWith("- "))) assert.match(l, /^- \[[^\]]+\]\([^)]+\)/);
  const local = [...txt.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]!).filter((u) => u.startsWith(SITE_ORIGIN)).map((u) => u.slice(SITE_ORIGIN.length));
  for (const path of local) {
    if (path === "/") continue; // the app page, written by scripts/build.ts
    assert.ok(existsSync(join(dist, path.split("?")[0]!)), `llms.txt link ${path} does not resolve`);
  }
  const full = read("llms-full.txt");
  assert.equal(full.split("\n").filter((l) => /^# /.test(l)).length, 1);
  for (const c of data.cities) assert.ok(full.includes(`## Living in ${c.name}`), `${c.name} missing from llms-full.txt`);
});

test("API: cities, one file per city with provenance, sources all redistributable", () => {
  const cities = JSON.parse(read("api/cities.json"));
  assert.equal(cities.count, data.cities.length);
  assert.equal(cities.dataset.licence, "CC-BY-4.0");
  const turin = JSON.parse(read("api/city/turin-it.json"));
  assert.equal(turin.name, data.cities.find((c) => c.id === "turin-it")!.name);
  for (const f of turin.figures) {
    assert.ok(f.period && f.level && f.retrieved);
    assert.ok(f.sources.length > 0 && f.sources.every((s: any) => s.licence && s.url !== undefined));
  }
  const sources = JSON.parse(read("api/sources.json")).sources;
  assert.ok(sources.length > 0 && sources.every((s: any) => s.redistributable === true));
  const metrics = JSON.parse(read("api/metrics.json"));
  assert.ok(metrics.metrics.length > 0 && metrics.criteria.length > 0);
});

test("the app page keeps the app and gains metadata and links to every city", () => {
  const app = read("index.html");
  assert.ok(app.includes('<div id="page"></div>'));
  assert.ok(app.includes('<link rel="canonical"'));
  for (const c of data.cities) assert.ok(app.includes(`href="city/${c.id}/"`), `${c.id} not linked from the app page`);
  const types = jsonLd(app).flatMap(nodes).map((n) => n["@type"]);
  assert.ok(types.includes("WebSite") && types.includes("WebApplication"));
});

test("design rules hold on the static pages: no disclosure triangles, no shadows", () => {
  const css = readFileSync(join(ROOT, "src/site/site.css"), "utf8");
  assert.ok(!/box-shadow|text-shadow/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  for (const p of manifest.pages.filter((x) => x !== "/").slice(0, 80)) assert.ok(!read(pageFile(p)).includes("<details"), `${p} uses <details>`);
});

test("the not-found page works at any depth and is never indexed", () => {
  const page = read("404.html");
  assert.match(page, /<head>\n<base href="\/">/);
  assert.ok(page.includes('<meta name="robots" content="noindex">'));
  assert.ok(!/rel="canonical"|rel="alternate"|application\/ld\+json|og:url/.test(page));
  for (const href of ["./", "cities/", "compare/", "sources/", "app.css"]) assert.ok(page.includes(`href="${href}"`), `404 links ${href}`);
  assert.ok(!manifest.pages.includes("/404.html") && !read("sitemap.xml").includes("404"));
});

test("only the listed docs are published, and every one exists", () => {
  for (const f of PUBLIC_DOCS) assert.ok(existsSync(join(dist, "docs", f)), `docs/${f} not published`);
  assert.ok(manifest.files.filter((f) => f.startsWith("docs/")).length === PUBLIC_DOCS.length);
});
