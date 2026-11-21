import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { ROOT } from "../pipeline/lib.ts";
import { criteriaFor, evaluate, scoreCandidates } from "../src/core/engine.ts";
import { chooseWork } from "../src/core/groups.ts";
import { resolve } from "../src/core/lookup.ts";
import { emptyProfile, firstProfile, type AppState } from "../src/ui/state.ts";
import { niceDayTable, niceDefinition, windImpact } from "../src/ui/cards.ts";
import { valuesSheet, share } from "../src/ui/values.ts";
import { canvasBuffer, canvasPoint, scoreShade } from "../src/ui/map-geometry.ts";
import { srcMark } from "../src/ui/results.ts";
import { AI_PROMPT, SETUP_STEPS } from "../src/ui/onboarding.ts";

const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json"));
const app = (): AppState => ({ data, profile: emptyProfile(data), view: "cities", city: null, measure: "air", valuesOpen: true, openGroups: ["money"], live: null, fetchedHere: [], taxOpen: [], moreOpen: true, shareInclude: [] });

test("empty start and reset factory clear personal inputs, not dataset defaults for reference pages", () => {
  for (const p of [firstProfile(data, "europe"), firstProfile(data, "north-america"), emptyProfile(data)]) {
    assert.deepEqual(p.cities, []);
    assert.equal(p.income.gross, 0);
    assert.deepEqual(p.income.perCity, {});
    assert.equal(p.income.everyday, null);
    assert.deepEqual(p.household, []);
    assert.deepEqual(p.dealBreakers, []);
    assert.deepEqual(p.overrides, {});
    assert.equal(evaluate(data, p).results.length, 0);
  }
  assert.equal(SETUP_STEPS.length, 5);
  assert.match(AI_PROMPT, /never call fetch_city on the remote server/);
  assert.match(AI_PROMPT, /Only include facts I confirmed/);
});

test("weights explain score shares; Required is placed with its line and never takes a share", () => {
  const s = app();
  s.profile.weights = Object.fromEntries(Object.keys(s.profile.weights).map((k) => [k, k === "money_left" ? 100 : 0]));
  assert.equal(share(100, 100), "100%");
  const html = valuesSheet(s).value;
  assert.match(html, /100% of score/);
  assert.match(html, /Share.*of your score, not money/);
  assert.match(html, /Lines split Money/);
  assert.match(html, /max="100"/);
  assert.match(html, /Required: rule out cities that fail/);
  const weights = html.slice(html.indexOf('<ul class="vals vgroups">'), html.indexOf('<section class="elig"'));
  assert.match(weights, /toggle-breaker.*data-id="money_left"/);
});

test("nice-day description and extensible table use the person's current weather, including wind and heat", () => {
  const s = app();
  s.profile.prefs.comfort = { min: 12, max: 24, basis: "air", dry: false, clear: false, calm: true, notMuggy: true, daylight: 11 };
  const desc = niceDefinition(s.profile.prefs.comfort);
  assert.match(desc, /12 to 24/);
  assert.match(desc, /air daytime/);
  assert.match(desc, /calm/);
  assert.doesNotMatch(desc, /18 to 30|dry, sunny/);
  const table = niceDayTable(s).value;
  for (const label of ["Temperature", "Dry", "Sunny", "Heat", "Calm", "Not muggy", "Daylight"]) assert.ok(table.includes(label));
  assert.match(table, /annual count, not each test/);
  assert.equal((table.match(/id="nt-calm"/g) ?? []).length, 1, "each weather switch occurs once, in its definition row");
  s.profile.cities = ["lisbon-pt", "london-gb"];
  assert.match(windImpact(s).value, /days excluded a year/);
});

test("pointer coordinates use logical canvas size at zoom 67%, 80%, 110% and resized fractional bounds", () => {
  for (const zoom of [0.67, 0.8, 1.1]) {
    for (const width of [390, 1000, 1440]) {
      const height = width / 2.05;
      const rect = { left: 23.25, top: 40.5, width: width * zoom, height: height * zoom };
      const point = canvasPoint(rect.left + rect.width * 0.21, rect.top + rect.height * 0.37, rect, width, height);
      assert.ok(Math.abs(point[0] - width * 0.21) < 1e-8);
      assert.ok(Math.abs(point[1] - height * 0.37) < 1e-8);
      assert.deepEqual(canvasBuffer(width, height, zoom), [Math.round(width * zoom), Math.round(height * zoom)]);
    }
  }
  assert.notDeepEqual(canvasBuffer(1000, 488, 0.67), canvasBuffer(1000, 488, 0.8), "DPR changes require a new buffer even if layout has not changed");
});

test("score lens recomputes work/weather scenarios and uses stable absolute colours", () => {
  let p = emptyProfile(data);
  p.cities = ["lisbon-pt", "london-gb", "berlin-de"];
  p = chooseWork(p, "software", criteriaFor(p), 100);
  const baseWeights = { ...p.weights };
  const work = { ...p, weights: Object.fromEntries(Object.entries(baseWeights).map(([id, w]) => [id, id === "nice_days" ? 1 : id === "money_left" ? 0 : w])) };
  const weather = { ...p, weights: Object.fromEntries(Object.entries(baseWeights).map(([id, w]) => [id, id === "nice_days" ? 100 : id === "money_left" ? 0 : w / 100])) };
  const a = scoreCandidates(data, work, p.cities);
  const b = scoreCandidates(data, weather, p.cities);
  const changes = p.cities.map((id) => Math.abs(a.get(id)!.total - b.get(id)!.total));
  assert.ok(Math.max(...changes) > 10, JSON.stringify(changes));
  for (const id of p.cities) assert.equal(scoreShade(a.get(id)!.total), a.get(id)!.total / 100);
  assert.equal(scoreShade(20), 0.2);
  assert.equal(scoreShade(80), 0.8);
});

test("rent, income, consensus and personal figures consistently identify their source", () => {
  const s = app();
  const city = data.cities.find((c) => c.id === "lisbon-pt")!;
  for (const metric of ["rent_1bed", "pay_all"]) {
    const r = resolve(data, s.profile, city, metric);
    assert.ok(r, metric);
    assert.match(srcMark(r, city.id, metric).value, /Source:|Sources:/);
  }
  s.profile.overrides = { [city.id]: { rent_1bed: 900 } };
  assert.match(srcMark(resolve(data, s.profile, city, "rent_1bed"), city.id, "rent_1bed").value, /Source: yours/);
});
