// A first visit starts near the visitor: the region of the request's country (read at the edge, never kept), five
// cities whose money figure is whole, what an example salary leaves in each, and why these cities, in plain words.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { money } from "../src/core/money.ts";
import { evaluate } from "../src/core/engine.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { countryName, fromText, REGIONS, regionOf, regionPage, spreadOf } from "../src/core/visit-region.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { withCity } from "../src/registry/licences.ts";
import { ROOT } from "../pipeline/lib.ts";
import { EXAMPLE_GROSS, exampleMoney, exampleProfile, passedOver, shortlist, wholeMoney } from "../src/ui/first-visit.ts";
import { defaultProfile, firstProfile, type AppState } from "../src/ui/state.ts";
import { verdict } from "../src/ui/top.ts";
import { handle, type Env } from "../src/site/worker.ts";
import { firstScreen, shortlists, splitDataset } from "../scripts/first-page.ts";

const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const text = (h: { value: string } | string) => (typeof h === "string" ? h : h.value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const app = (profile: Profile, over: Partial<AppState> = {}): AppState => ({ data, profile, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [], intro: true, ...over });

test("a country maps to its region; an unknown or missing one starts from Europe", () => {
  assert.equal(regionOf("US"), "north-america");
  assert.equal(regionOf("ca"), "north-america");
  assert.equal(regionOf("BR"), "latin-america");
  assert.equal(regionOf("IN"), "asia-pacific");
  assert.equal(regionOf("AE"), "middle-east-africa");
  assert.equal(regionOf("IT"), "europe");
  for (const none of ["", null, undefined, "XX", "T1"]) assert.equal(regionOf(none), "europe");
  assert.equal(regionPage("europe"), "/");
  assert.equal(regionPage("asia-pacific"), "/r/asia-pacific/");
  assert.equal(countryName("US"), "United States");
  for (const no of ["ZZ", "XX", "T1", "us", ""]) assert.equal(countryName(no), null, no);
});

test("the reason names the country when the request had one, and never says a city is in a region it is not", () => {
  assert.equal(fromText("europe", "IT", "in"), "This visit comes from Italy (read from the request, never kept), so these cities are in Europe.");
  assert.match(fromText("north-america", "US", "mixed"), /^This visit comes from the United States .*start in North America, then add a few elsewhere\.$/);
  assert.equal(fromText("latin-america", null, "out"), "These cities are outside Latin America, where no city in Borgo has every money figure yet.");
  assert.equal(spreadOf("europe", ["ES", "DE"]), "in");
  assert.equal(spreadOf("north-america", ["CA", "GB"]), "mixed");
  assert.equal(spreadOf("latin-america", ["ES", "CA"]), "out");
});

test("each region's shortlist: up to five of its candidates, in order, each with a whole money figure", () => {
  const base = defaultProfile(data);
  for (const r of REGIONS) {
    const list = shortlist(data, r.id, base);
    assert.ok(list.length > 0 && list.length <= 5, `${r.id}: ${list}`);
    const order = list.map((id) => r.candidates.indexOf(id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${r.id} keeps the candidates' order`);
    const p = defaultProfile(data, list);
    assert.deepEqual(firstProfile(data, r.id).cities, [], "first visits no longer use the reference shortlist");
    for (const id of list) assert.ok(wholeMoney(money(data, exampleProfile(p), data.cities.find((c) => c.id === id)!)), `${id} has whole money`);
  }
  // Europe starts from the cities the reference pages use; Amsterdam's money leaves out the health premium, so a list
  // that reached it would pass it over and say so.
  const eu = shortlist(data, "europe", base);
  assert.deepEqual(eu, ["lisbon-pt", "barcelona-es", "berlin-de", "london-gb", "madrid-es"]);
  assert.deepEqual(passedOver("europe", eu), []);
  assert.deepEqual(passedOver("europe", ["lisbon-pt", "vienna-at"]), ["barcelona-es", "berlin-de", "london-gb", "madrid-es", "amsterdam-nl"]);
  assert.ok(!shortlist(data, "europe", base, 12).includes("amsterdam-nl"));
});

test("before a salary, first visits are empty in every region and never display example money", () => {
  for (const region of REGIONS) {
    const p = firstProfile(data, region.id);
    assert.deepEqual(p.cities, []);
    assert.equal(p.income.gross, 0);
    assert.equal(p.income.everyday, null);
    const v = text(verdict(app(p), evaluate(data, p)));
    assert.match(v, /Add the cities you are weighing/);
    assert.doesNotMatch(v, /60,000|example|fits you best/);
  }
});

test("the split data: the core has no figures, the per-city files put every figure back, the shortlists are the app's", () => {
  const lists = shortlists(data);
  const { core, cities } = splitDataset(data as never, lists);
  assert.deepEqual(core.observations, {});
  assert.equal(core.perCity, "data/city/");
  let back: Dataset = { ...core };
  for (const [id, list] of Object.entries(cities)) back = withCity(back, id, list);
  assert.deepEqual(back.observations, data.observations);
  for (const r of REGIONS) assert.deepEqual(lists[r.id], [], "empty first pages preload no example cities");
});

test("each region's first screen is empty with guided setup before the app runs", () => {
  const html = firstScreen({ ...data, shortlists: shortlists(data) } as Dataset, "europe");
  assert.doesNotMatch(html, /Add the cities you are weighing\./, "setup asks for cities once, not twice");
  assert.doesNotMatch(html, /class="v-example"|class="v-from"/);
  assert.match(html, /Add a city to start/);
  assert.match(html, /Which cities are you weighing\?/);
});

// ---------- The edge: the region's page for the request's country, never kept ----------

const PAGE = (region: string) => `<!doctype html><html lang="en" data-region="${region}" data-country=""><body><span class="v-from" data-where="mixed">These cities start in X, then add a few elsewhere.</span></body></html>`;
const asked: string[] = [];
const env: Env = {
  ASSETS: {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      if (pathname === "/") return new Response(PAGE("europe"), { status: 200, headers: { "content-type": "text/html", etag: '"e"', "cache-control": "public, max-age=0" } });
      const m = pathname.match(/^\/r\/([a-z-]+)\/$/);
      if (m) return new Response(PAGE(m[1]!), { status: 200, headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    },
  },
};
const visit = (country?: string, path = "/") => {
  const r = new Request(`https://borgo.abcastor.com${path}`);
  if (country !== undefined) Object.defineProperty(r, "cf", { value: { country } });
  return handle(r, env);
};

test("the app page is the region's, with the country named, kept by no shared cache, and nothing logged", async () => {
  const said: unknown[] = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of Object.keys(keep) as (keyof typeof keep)[]) console[k] = (...a: unknown[]) => void said.push(a);
  try {
    asked.length = 0;
    const us = await visit("US");
    assert.deepEqual(asked, ["/r/north-america/"]);
    const page = await us.text();
    assert.match(page, /data-region="north-america" data-country="US"/);
    assert.match(page, /This visit comes from the United States \(read from the request, never kept\), so these cities start in North America, then add a few elsewhere\./);
    assert.equal(us.headers.get("cache-control"), "private, no-cache");
    assert.equal(us.headers.get("etag"), null);
    const none = await (await visit()).text();
    assert.match(none, /data-region="europe" data-country=""/);
    assert.match(none, /These cities start in X/, "without a country the page is as built");
    for (const unknown of ["ZZ", "XX", "T1"]) assert.match(await (await visit(unknown)).text(), /data-region="europe" data-country="".*These cities start in X/s, unknown);
    assert.equal((await visit("US", "/r/north-america/")).status, 404, "region pages are served as / only");
    assert.deepEqual(said, []);
  } finally {
    Object.assign(console, keep);
  }
});
