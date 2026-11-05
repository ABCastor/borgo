import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { evaluate, scoreCandidates } from "../src/core/engine.ts";
import { project, unproject } from "../src/core/equal-earth.ts";
import { monthsInRange, tileCount, validateMap, type WorldMap } from "../src/core/world-map.ts";
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
