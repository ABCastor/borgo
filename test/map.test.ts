import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { monthsInRangeOf } from "../src/core/criteria.ts";
import { evaluate, scoreCandidates } from "../src/core/engine.ts";
import { project, unproject } from "../src/core/equal-earth.ts";
import { monthsInRange, tileCount, validateMap, type WorldMap } from "../src/core/world-map.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { cardFor, pinAfterClick, type Target } from "../src/ui/map-card.ts";
import type { AppState } from "../src/ui/state.ts";
import { fixture, profile } from "./fixture.ts";

const root = join(import.meta.dirname, "..");

test("map: Equal Earth goes there and back, and refuses points outside its outline", () => {
  for (const [lon, lat] of [[0, 0], [7.69, 45.07], [-122.42, 37.77], [151.2, -33.87], [179.9, 84], [-179.9, -56]] as const) {
    const back = unproject(...project(lon, lat))!;
    assert.ok(Math.abs(back[0] - lon) < 1e-6 && Math.abs(back[1] - lat) < 1e-6, `${lon},${lat} came back as ${back}`);
  }
  assert.ok(Math.abs(project(180, 0)[0] - 2.7064) < 1e-3, "the map is 2.7064 units either side of the meridian");
  assert.equal(unproject(2.7, 1.2), null, "a corner of the rectangle lies outside the map");
});

test("map: a candidate scores exactly as it would once added to the person's cities", () => {
  const data = fixture();
  const p = profile({ cities: ["turin-it", "dublin-ie"] });
  const scored = scoreCandidates(data, p, ["london-gb", "san-francisco-us", "turin-it"]);
  const own = evaluate(data, p).results.find((r) => r.city.id === "turin-it")!;
  assert.equal(scored.get("turin-it")!.total, own.total, "a chosen city keeps its own result");
  for (const id of ["london-gb", "san-francisco-us"]) {
    const added = evaluate(data, { ...p, cities: [...p.cities, id] }).results.find((r) => r.city.id === id)!;
    assert.equal(scored.get(id)!.total, added.total, id);
    assert.equal(scored.get(id)!.rank, added.rank, id);
    assert.deepEqual(scored.get(id)!.ruledOut, added.ruledOut, id);
  }
});

test("map: months in range count whole-degree highs at both ends of the range", () => {
  const m = { highs: [175, 180, 220, 270, 274, 275, 300, 100, -50, 181, 269, 265], tiles: [0, 0, 0] } as unknown as WorldMap;
  // 17.5 rounds to 18 (in), 27.4 rounds to 27 (in), 27.5 rounds to 28 (out).
  assert.equal(monthsInRange(m, 0, 18, 27), 8);
});

test("map: the committed world map is sound and covers the seed cities' countries", () => {
  const map = JSON.parse(readFileSync(join(root, "data/map/world.json"), "utf8")) as WorldMap;
  const countries = JSON.parse(readFileSync(join(root, "data/countries.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(validateMap(map, new Set(Object.keys(countries))), []);
  assert.ok(tileCount(map) > 4000, "the whole world's land, Antarctica aside");
  const cities = JSON.parse(readFileSync(join(root, "data/cities.json"), "utf8")) as { country: string }[];
  const onMap = new Set(map.countries);
  // Small countries can share a tile with a neighbour; every other seed country has land of its own.
  const missing = [...new Set(cities.map((c) => c.country))].filter((cc) => !onMap.has(cc) && !["SG", "LU", "MT", "LI", "MC"].includes(cc));
  assert.deepEqual(missing, []);
  assert.deepEqual(map.sources.map((s) => s.id).sort(), ["nasa-power", "natural-earth"]);
});

// ---------- Months in the person's range, per place ----------

const TURIN_AIR = [6, 9, 14, 17, 21, 26, 28, 28, 23, 17, 11, 7];
const TURIN_FEELS = [5, 8, 13, 18, 22, 28, 31, 31, 25, 17, 10, 6];

function withFeels(): Dataset {
  const data = fixture();
  data.observations["turin-it"]!.push({ metric: "feels_high", value: TURIN_FEELS, period: "2025", level: "city", source: "test", retrieved: "2026-10-27" });
  return data;
}

test("map: a city's months in range are counted on the person's basis, feels like by default", () => {
  const data = withFeels();
  const turin = data.cities.find((c) => c.id === "turin-it")!;
  const feels = monthsInRangeOf(data, profile({ prefs: { comfort: { min: 18, max: 30, basis: "feels" }, normalise: "absolute", missing: "average" } }), turin)!;
  // 18, 22, 28 and 25 are in; 31 in July and August is too hot.
  assert.deepEqual({ count: feels.count, basis: feels.basis }, { count: 4, basis: "feels" });
  assert.deepEqual(feels.months, TURIN_FEELS.map((h) => h >= 18 && h <= 30));
  const air = monthsInRangeOf(data, profile({ prefs: { comfort: { min: 18, max: 30, basis: "air" }, normalise: "absolute", missing: "average" } }), turin)!;
  assert.deepEqual({ count: air.count, basis: air.basis }, { count: 5, basis: "air" }, "21, 26, 28, 28 and 23 in the air");
});

test("map: a city without feels-like highs falls back to the air, and says so; none at all is null", () => {
  const data = fixture();
  const p = profile({ prefs: { comfort: { min: 18, max: 30, basis: "feels" }, normalise: "absolute", missing: "average" } });
  const r = monthsInRangeOf(data, p, data.cities.find((c) => c.id === "turin-it")!)!;
  assert.deepEqual({ count: r.count, basis: r.basis }, { count: 5, basis: "air" });
  assert.equal(monthsInRangeOf(data, p, data.cities.find((c) => c.id === "dublin-ie")!), null, "no monthly highs, no count");
});

test("map: months in range follow the range as it changes, for a city and for the land alike", () => {
  const data = fixture();
  const turin = data.cities.find((c) => c.id === "turin-it")!;
  const tile = { highs: TURIN_AIR.map((h) => h * 10), tiles: [0, 0, 0] } as unknown as WorldMap;
  for (const [min, max] of [[18, 30], [10, 20], [25, 35], [0, 45], [40, 45]] as const) {
    const p = profile({ prefs: { comfort: { min, max, basis: "air" }, normalise: "absolute", missing: "average" } });
    const city = monthsInRangeOf(data, p, turin)!.count;
    assert.equal(city, TURIN_AIR.filter((h) => h >= min && h <= max).length, `${min}–${max}`);
    assert.equal(monthsInRange(tile, 0, min, max), city, `a tile with Turin's highs reads as Turin at ${min}–${max}`);
  }
});

// ---------- The card: a click pins it, and only its button adds ----------

const app = (data: Dataset, p: Profile): AppState => ({ data, profile: p, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [] });
const MAP = { version: "t", projection: "equal-earth", x0: 0, y0: 0, pitch: 1, cols: 1, rows: 1, countries: ["IT"], tiles: [0, 0, 0], highs: TURIN_AIR.map((h) => h * 10), places: [["Asti", "IT", 44.9, 8.21, 75_000, 3182713]], sources: [] } as unknown as WorldMap;
const adds = (markup: string) => [...markup.matchAll(/<button[^>]*data-act="(add-known|map-add-place)"[^>]*>([^<]*)<\/button>/g)].map((m) => ({ act: m[1], text: m[2] }));

test("map: a click pins a place, a second click on it unpins, and clicking never adds", () => {
  const asti: Target = { kind: "land", tile: 0, place: MAP.places[0]! };
  const london: Target = { kind: "city", id: "london-gb" };
  assert.deepEqual(pinAfterClick(null, london), london);
  assert.equal(pinAfterClick(london, { kind: "city", id: "london-gb" }), null);
  assert.deepEqual(pinAfterClick(london, asti), asti, "another place moves the pin");
  assert.equal(pinAfterClick(asti, null), null, "the sea unpins");
});

test("map: pin then add: the pointed-at card has no add button, the pinned card has one, and it adds that place", () => {
  const data = fixture();
  const p = profile({ cities: ["turin-it", "dublin-ie"] });
  const s = app(data, p);
  const before = JSON.stringify(p.cities);
  const result = scoreCandidates(data, p, ["london-gb"]).get("london-gb")!;
  const hover = cardFor(s, { kind: "city", id: "london-gb" }, { map: MAP, pinned: false, result }).value;
  assert.deepEqual(adds(hover), [], "pointing at a place offers no add");
  const pinned = cardFor(s, { kind: "city", id: "london-gb" }, { map: MAP, pinned: true, result }).value;
  assert.deepEqual(adds(pinned), [{ act: "add-known", text: "Add to my cities" }]);
  assert.match(pinned, /data-act="add-known" data-city="london-gb"/);
  assert.match(pinned, /would be No\. \d of 3/);
  assert.match(pinned, /Take-home/, "a salary is set, so the card says what you take home");
  assert.equal(JSON.stringify(p.cities), before, "pinning changes nothing in the comparison");

  const own = cardFor(s, { kind: "city", id: "turin-it" }, { map: MAP, pinned: true, result: scoreCandidates(data, p, []).get("turin-it") }).value;
  assert.deepEqual(adds(own), [], "a city already yours offers its dossier, not an add");
  assert.match(own, /5 months<\/b> of 12/, "the card counts Turin's months in the range");

  const town = cardFor(s, { kind: "land", tile: 0, place: MAP.places[0]! }, { map: MAP, pinned: true }).value;
  assert.deepEqual(adds(town), [{ act: "map-add-place", text: "Add to my cities" }]);
  assert.match(town, /data-q="geonames:3182713"/, "a town is added by its GeoNames id");
  assert.match(town, /Take-home/);
  assert.equal(adds(cardFor(s, { kind: "land", tile: 0, place: MAP.places[0]! }, { map: MAP, pinned: false }).value).length, 0);
});

test("map: the card says take-home only once a salary is given", () => {
  const data = fixture();
  const p = profile({ cities: ["turin-it"] });
  p.income = { ...p.income, gross: 0 };
  const s = app(data, p);
  const result = scoreCandidates(data, p, ["london-gb"]).get("london-gb")!;
  assert.doesNotMatch(cardFor(s, { kind: "city", id: "london-gb" }, { map: MAP, pinned: true, result }).value, /Take-home/);
  assert.doesNotMatch(cardFor(s, { kind: "land", tile: 0, place: MAP.places[0]! }, { map: MAP, pinned: true }).value, /Take-home/);
});
