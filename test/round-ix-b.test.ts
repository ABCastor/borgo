import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server.ts";
import { ROOT } from "../src/agent/dataset.ts";
import { aiSetup, AI_PROMPT } from "../src/ui/onboarding.ts";
import { withFetched } from "../src/fetch/index.ts";
import { test } from "node:test";
import type { Person } from "../src/core/types.ts";
import { BINS, BIN_COUNT } from "../src/core/weather-days.ts";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate, scoreCandidates, weightOf, criteriaFor } from "../src/core/engine.ts";
import { householdRights } from "../src/core/rights.ts";
import { LICENCES } from "../src/registry/licences.ts";
import { ENTRY_ROUTES } from "../src/core/entry-routes.ts";
import { suggestCities } from "../src/core/suggest.ts";
import { suggest } from "../src/agent/suggest.ts";
import { addEarner, emptyProfile, loadProfile, saveProfile, type AppState } from "../src/ui/state.ts";
import { valuesSheet } from "../src/ui/values.ts";
import { fixture, profile } from "./fixture.ts";

const zero = Object.fromEntries(CRITERIA.map((c) => [c.id, 0]));
const app = (data: ReturnType<typeof fixture>, p: ReturnType<typeof profile>): AppState => ({ data, profile: p, view: "cities", city: null, measure: "air", valuesOpen: true, openGroups: ["people", "nature", "stand", "climate", "money"], live: null, fetchedHere: [], taxOpen: [], moreOpen: true, shareInclude: [] });

test("partner pay reuses the existing partner; removal leaves only you", () => {
  const p = emptyProfile(fixture());
  p.household = [{ label: "You", citizenships: [] }, { label: "Partner", citizenships: ["IT"], relation: "partner" }];
  addEarner(p, "Partner");
  assert.equal(p.household.length, 2);
  assert.deepEqual(p.household[1]!.citizenships, ["IT"]);
  assert.equal(p.household[1]!.pay!.gross, 0);
  assert.match(valuesSheet(app(fixture(), p)).value, /aria-label="Remove Partner"/);
  p.household.splice(1, 1);
  assert.equal(p.household.length, 1);
});

test("fixed scores and line contributions are invariant under every add/remove subset, including money and gaps", () => {
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => !["rent_1bed", "pm25"].includes(o.metric));
  const ids = d.cities.map((c) => c.id);
  for (const missing of ["lowest", "skip", "worst", "average"] as const) {
    const p = profile({ prefs: { ...profile().prefs, normalise: "absolute", missing } });
    for (const id of ids) {
      const one = evaluate(d, { ...p, cities: [id] }).results[0]!;
      for (let mask = 0; mask < 1 << ids.length; mask++) {
        const cities = ids.filter((_, i) => mask & 1 << i);
        if (!cities.includes(id)) continue;
        const actual = evaluate(d, { ...p, cities }).results.find((r) => r.city.id === id)!;
        assert.equal(actual.total, one.total, `${id}, ${missing}, ${cities}`);
        assert.deepEqual(actual.lines.map((l) => [l.score, l.weight, l.points]), one.lines.map((l) => [l.score, l.weight, l.points]));
        assert.equal(scoreCandidates(d, { ...p, cities: cities.filter((x) => x !== id) }, [id]).get(id)!.total, one.total);
      }
    }
  }
});

test("Required filters without taking score share, restoring the original weight on release", () => {
  const d = fixture();
  const p = profile({ weights: { ...zero, clean_air: 70, right_to_live: 30 }, household: [{ label: "You", citizenships: ["IT"] }], dealBreakers: ["right_to_live"] });
  const e = evaluate(d, p);
  for (const r of e.results) {
    const right = r.lines.find((l) => l.id === "right_to_live")!;
    assert.equal(right.weight, 0);
    assert.equal(right.points, 0);
    assert.equal(r.total, r.lines.find((l) => l.id === "clean_air")!.score! * 100);
  }
  assert.ok(e.results.find((r) => r.city.id === "london-gb")!.ruledOut.length);
  assert.equal(p.weights.right_to_live, 30);
  assert.equal(weightOf({ ...p, dealBreakers: [] }, criteriaFor(p).find((c) => c.id === "right_to_live")!), 30);
  assert.match(valuesSheet(app(d, p)).value, /Required: rule out cities that fail/);
});

test("entry difficulty is sourced, person-specific, household constrained by hardest route, and otherwise not checked", () => {
  const d = fixture();
  const people: Person[] = [{ label: "You", citizenships: ["CA"], entryRoutes: { GB: "gb-ancestry", US: "us-h1b" } }, { label: "Partner", citizenships: ["IT"], entryRoutes: { GB: "gb-skilled" } }];
  const gb = householdRights(d, people, "GB");
  assert.deepEqual(gb.map((r) => r.entryLevel), ["straightforward", "demanding"]);
  assert.ok(gb.every((r) => r.sources.some((s) => /gov.uk/.test(s.url))));
  assert.equal(householdRights(d, people, "US")[0]!.entryLevel, "very-hard");
  assert.equal(householdRights(d, people, "JP")[0]!.entryLevel, "not-checked");
  assert.equal(householdRights(d, [{ label: "You", citizenships: ["GB"], entryRoutes: { GB: "gb-skilled" } }], "GB")[0]!.entryLevel, "already");
  const r = evaluate(d, profile({ cities: ["london-gb"], household: people, weights: { ...zero, right_to_live: 100 } })).results[0]!;
  assert.equal(r.total, 40);
  const routeOnly = profile({ cities: ["london-gb"], household: [{ label: "You", citizenships: [], entryRoutes: { GB: "gb-skilled" } }], weights: { ...zero, right_to_live: 100 } });
  const checkedRoute = evaluate(d, routeOnly).results[0]!;
  assert.equal(checkedRoute.total, 40, "a confirmed route can be scored even when existing passports are not given");
  assert.equal(checkedRoute.lines.find((l) => l.id === "right_to_live")!.check, "unknown", "a prospective route does not prove or disprove an existing right");
  assert.equal(evaluate(d, { ...routeOnly, dealBreakers: ["right_to_live"] }).results[0]!.unresolved.length, 1);
  assert.match(r.lines.find((l) => l.id === "right_to_live")!.raw.text, /rough guide, not legal advice/);
  for (const source of ENTRY_ROUTES) {
    for (const field of [source.url, source.period, source.licence, source.licenceUrl, source.read]) assert.ok(field.length);
    assert.equal(LICENCES[source.licence]?.part, "open", "entry facts use an existing redistributable licence id, not a parallel catalogue");
  }
});

test("a fetched-style city gap is explicit both in the score and its priority row; no imputation", () => {
  const d = fixture();
  const city = d.cities.find((c) => c.id === "dublin-ie")!;
  city.name = "Foligno";
  d.observations[city.id] = [];
  const p = profile({ cities: [city.id, "turin-it"], weights: { ...zero, happiness: 10, sea: 10 } });
  const r = evaluate(d, p).results.find((r) => r.city.id === city.id)!;
  for (const id of ["happiness", "sea"]) {
    const line = r.lines.find((l) => l.id === id)!;
    assert.equal(line.score, null);
    assert.equal(line.imputed, false);
    assert.match(line.raw.text, /No figure for Foligno, so it does not count there/);
  }
  assert.match(valuesSheet(app(d, p)).value, /No figures for (?:Foligno and Torino|Torino and Foligno): .* counts once you add its missing inputs or figures/);
});

test("own lines and ratings persist through save/load and change the fixed score", () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { hash: "", search: "" } });
  try {
    const d = fixture();
    const p = profile({ weights: { ...zero, "mine-family": 10 }, personal: [{ id: "mine-family", label: "Family nearby", scores: { "turin-it": 5 } }] });
    saveProfile(p);
    const loaded = loadProfile(d);
    assert.deepEqual(loaded.personal, p.personal);
    assert.equal(evaluate(d, loaded).results.find((r) => r.city.id === "turin-it")!.total, 100);
  } finally { Reflect.deleteProperty(globalThis, "localStorage"); Reflect.deleteProperty(globalThis, "location"); }
});

test("suggestions exclude selected cities, use exactly their added scores, supply two reasons, and respect Required", () => {
  const d = fixture();
  const p = profile({ cities: ["turin-it"], weights: { ...zero, clean_air: 50, winter_light: 50 } });
  const choices = suggestCities(d, p);
  assert.equal(choices.length, d.cities.length - 1);
  for (const c of choices) {
    assert.notEqual(c.id, "turin-it");
    assert.equal(c.reasons.length, 2);
    assert.equal(c.score, evaluate(d, { ...p, cities: [...p.cities, c.id] }).results.find((r) => r.city.id === c.id)!.total);
  }
  const filtered = suggestCities(d, { ...p, household: [{ label: "You", citizenships: ["IT"] }], dealBreakers: ["right_to_live"] });
  assert.deepEqual(filtered.map((c) => c.country), ["IE"]);
  assert.ok(suggest(d, { cities: [], only: ["safety"] }).cities.length);
  const fetched = { city: { ...d.cities[0]!, id: "private-place-it", name: "Private place" }, observations: [], outcomes: [], fetchedAt: "2026-11-19" };
  const merged = withFetched(d, [fetched]);
  assert.ok(suggestCities(merged, p).every((c) => c.id !== fetched.city.id), "unpublished cached places are not suggested");
});

test("suggestions put cities with figures for most weighted lines ahead of cities with gaps", () => {
  const p = profile({ cities: [], weights: { ...zero, clean_air: 50, winter_light: 50 } });
  let checked = 0;
  for (const city of fixture().cities) {
    const d = fixture();
    d.observations[city.id] = (d.observations[city.id] ?? []).filter((o) => o.metric !== "pm25");
    const all = [...scoreCandidates(d, p, d.cities.map((c) => c.id)).values()];
    const gap = all.find((r) => r.city.id === city.id)!;
    const full = all.filter((r) => r.city.id !== city.id && r.coverage === 1);
    if (gap.coverage === 1 || !full.some((r) => r.total < gap.total)) continue;
    checked++;
    const order = suggestCities(d, p).map((c) => c.id);
    const lastFull = Math.max(...full.map((r) => order.indexOf(r.city.id)).filter((i) => i >= 0));
    const at = order.indexOf(city.id);
    assert.ok(at === -1 || at > lastFull, `${city.id}, missing clean air, outranks a fully covered city`);
  }
  assert.ok(checked > 0, "the fixture has a gap city scoring above a fully covered one");
});

test("CLI and MCP expose suggestions with profile parity and no sending or browser mutation", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(fixture());
  await server.connect(serverSide);
  const client = new Client({ name: "suggest-test", version: "1" });
  await client.connect(clientSide);
  try {
    const args = { cities: ["Torino"], only: ["clean_air", "winter_light"] };
    const reply = await client.callTool({ name: "suggest_cities", arguments: args });
    assert.notEqual(reply.isError, true);
    const result = reply.structuredContent as unknown as ReturnType<typeof suggest>;
    assert.deepEqual(result.cities, suggest(fixture(), args).cities);
  } finally { await client.close(); await server.close(); }
  const cache = mkdtempSync(join(tmpdir(), "borgo-suggest-test-"));
  try {
    const output = execFileSync(process.execPath, [join(ROOT, "bin/borgo.ts"), "suggest", "Torino", "--only", "clean_air,winter_light", "--json"], { encoding: "utf8", env: { ...process.env, BORGO_HOME: cache } });
    const result = JSON.parse(output) as ReturnType<typeof suggest>;
    assert.equal(result.cities.length, 5);
    assert.ok(result.cities.every((c) => c.id !== "turin-it" && c.reasons.length === 2));
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test("Weather keeps its name and explains actual 62-day and midpoint contributions, not an invented median", () => {
  const d = fixture();
  const bins = Array(12 * BIN_COUNT).fill(0) as number[];
  bins[22 - BINS.from] = 31;
  bins[BIN_COUNT + 22 - BINS.from] = 31;
  d.observations["turin-it"]!.push({ metric: "nice_bins_feels", value: bins, source: "test", period: "2021-2025", level: "city", retrieved: "2026-11-19" });
  const p = profile({ cities: ["turin-it"], weights: { ...zero, nice_days: 100 } });
  const weather = evaluate(d, p).results[0]!.lines.find((l) => l.id === "nice_days")!;
  assert.equal(weather.raw.value, 62);
  assert.equal(weather.score, 0.21);
  assert.equal(weather.points, 21);
  assert.match(weather.explanation!, /62 nice days.*21\/100.*21.0 points/);
  assert.doesNotMatch(weather.explanation!, /median/);
  for (const weight of [0, 100]) {
    const ui = valuesSheet(app(d, { ...p, weights: { ...p.weights, nice_days: weight } })).value;
    assert.match(ui, /for="wg-climate"[^>]*>Weather<\/label>/);
  }
  const midpoint = evaluate(d, { ...p, weights: { ...zero, gut: 10 }, personal: [{ id: "gut", label: "Gut", scores: { "turin-it": 3 } }] }).results[0]!.lines.find((l) => l.id === "gut")!;
  assert.match(midpoint.explanation!, /middle of the fixed scale.*neither helps nor hurts/);
});

test("AI launch URLs carry the exact short prompt and stay below a conservative 2000 characters", () => {
  const html = aiSetup().value;
  for (const host of ["chatgpt.com", "claude.ai"]) {
    const raw = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).find((u) => u.includes(host))!;
    const url = new URL(raw.replaceAll("&amp;", "&"));
    assert.equal(url.searchParams.get("q"), AI_PROMPT);
    assert.ok(raw.length < 2000);
    assert.ok(url.pathname === (host === "claude.ai" ? "/new" : "/"));
  }
});
