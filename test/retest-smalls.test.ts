// Small things a reader notices: units, words for flags and laws, rounding, same-named cities, shares and points.
// Each test checks the text a person would otherwise read wrong.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../pipeline/lib.ts";
import { placeFetchMarkdown, type PlaceFetch } from "../src/agent/fetch-place.ts";
import { compare } from "../src/agent/report.ts";
import { compareMarkdown } from "../src/agent/markdown.ts";
import { evaluate } from "../src/core/engine.ts";
import { METRICS } from "../src/core/metrics.ts";
import { DEFAULT_UNITS } from "../src/core/units.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { figureText } from "../src/site/facts.ts";
import { cityView } from "../src/ui/detail.ts";
import { useUnits } from "../src/ui/format.ts";
import { defaultProfile, type AppState } from "../src/ui/state.ts";
import { fixture, profile } from "./fixture.ts";

const published = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const app = (data: Dataset, p: Profile): AppState => ({ data, profile: p, view: "city", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [] });
const text = (h: { value: string }) => h.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("miles reach the city sheet: the sea, 'within 10 km' and a station '1 km away'", () => {
  const p = { ...defaultProfile(published), cities: ["lisbon-pt"], prefs: { ...defaultProfile(published).prefs, units: { temp: "C" as const, distance: "mi" as const } } };
  useUnits({ ...DEFAULT_UNITS, distance: "mi" });
  try {
    const sheet = text(cityView(app(published, p), evaluate(published, p), "lisbon-pt"));
    // The re-test read "Distance to the sea 2 km", "Coworking spaces 37 within 10 km" and "Lisboa / Geof, 1 km away".
    assert.doesNotMatch(sheet, /\d\s?km\b/, sheet.match(/.{40}\d\s?km\b.{20}/)?.[0] ?? "");
    // A density converts as a ratio: 0.82 km per km² is 1.32 mi per mi².
    assert.match(sheet, /Cycle network 1\.32 mi per mi²/);
    assert.match(sheet, /within 6\s?mi/);
    assert.match(sheet, /Distance to the sea \d+(\.\d)?\s?mi/);
    assert.match(sheet, /0\.6\s?mi away/);
    // Labels too ("Airports within 100 km"), and a flag in words ("English is official 0 1 = yes").
    assert.match(sheet, /Airports within 62\s?mi/);
    assert.match(sheet, /English is official no\b/);
    assert.doesNotMatch(sheet, /1 = /);
  } finally {
    useUnits(DEFAULT_UNITS);
  }
});

test("static pages say a flag, a law and one of a thing in words", () => {
  // The re-test read "2 0 to 4", "0 1 = yes", "1 1 = a chapter" and "1 organisations".
  assert.equal(figureText(1, METRICS.english_official!, "EUR"), "yes");
  assert.equal(figureText(0, METRICS.english_official!, "EUR"), "no");
  assert.equal(figureText(1, METRICS.founders_running_club!, "EUR"), "a chapter");
  assert.equal(figureText(0, METRICS.founders_running_club!, "EUR"), "no chapter");
  assert.equal(figureText(1, METRICS.universities!, "EUR", 0), "1 organisation");
  assert.equal(figureText(3, METRICS.universities!, "EUR", 0), "3 organisations");
  const law = figureText(2, METRICS.abortion_law!, "EUR");
  assert.doesNotMatch(law, /0 to 4/);
  assert.match(law, /[a-z]{4}/);
});

test("fetch_city rounds a figure to its metric's decimals", () => {
  const d = fixture();
  const city = d.cities[0]!;
  const r = {
    fetched: { city, observations: [{ metric: "annual_leave", value: 21.428571428571427, period: "2026", level: "country", source: "labour-law" }], outcomes: [], fetchedAt: "2026-11-05T15:00:00Z" },
    lacks: [],
    alternatives: [],
    fromCache: false,
  } as unknown as PlaceFetch;
  const md = placeFetchMarkdown(r, { ...d, metrics: { ...d.metrics, annual_leave: METRICS.annual_leave! } });
  assert.doesNotMatch(md, /21\.428571/);
  // annual_leave is shown to no decimals.
  assert.equal(METRICS.annual_leave!.decimals ?? 2, 0);
  assert.match(md, /\| 21 working days a year \|/);
});

test("spending is one figure for every city: the next step never says 'your spending for Lisbon'", () => {
  // Lisbon has no open rent, Dublin has one; neither has spending. The re-test read "add your rent; add your spending for Lisbon".
  const r = compare(published, { cities: ["Lisbon", "Dublin"], salary: { amount: 60_000 } });
  const note = r.notes.find((n) => /spending/.test(n))!;
  assert.match(note, /add your rent for Lisbon; add your spending\.$/);
});

test("two compared cities of one name are told apart by country in every row", () => {
  // The re-test's `borgo compare "Cambridge, GB" cambridge-us` printed two rows reading "Cambridge".
  const d = fixture();
  const sf = d.cities.find((c) => c.id === "san-francisco-us")!;
  d.cities.push({ ...sf, id: "dublin-us", name: "Dublin", region: "US-CA" });
  d.observations["dublin-us"] = d.observations["san-francisco-us"]!;
  const r = compare(d, { cities: ["dublin-ie", "dublin-us"] });
  assert.deepEqual(r.ranking.map((x) => x.name).sort(), ["Dublin, IE", "Dublin, US"]);
  const md = compareMarkdown(r);
  assert.match(md, /\| Dublin, IE \|/);
  assert.match(md, /\| Dublin, US \|/);
  // A name used once stays as it is.
  assert.deepEqual(compare(d, { cities: ["dublin-ie", "turin-it"] }).ranking.map((x) => x.name).sort(), ["Dublin", "Torino"]);
});

test("a line's points never exceed the share shown beside it, when another line scores nowhere", () => {
  // The re-test's Lisbon sheet: nice days at "50% of your score" carried 47.2 points, because money (the other 50%)
  // had no figure and its weight went to nice days. The share shown is now of this score.
  const base = defaultProfile(published);
  const zero = Object.fromEntries(Object.keys(base.weights).map((k) => [k, 0]));
  const p = { ...base, cities: ["lisbon-pt"], weights: { ...zero, nice_days: 50, money_left: 50 } };
  const e = evaluate(published, p);
  const r = e.results[0]!;
  const sheet = text(cityView(app(published, p), e, "lisbon-pt"));
  assert.match(sheet, /Nice days 100% of your score/);
  assert.match(sheet, /set to 50%, not in this score: no figure to compare/);
  for (const l of r.lines.filter((x) => x.weight > 0)) {
    const shown = /Nice/.test(l.label) ? 100 : 0;
    assert.ok(l.points <= shown + 1e-9, `${l.label}: ${l.points} points against ${shown}%`);
  }
});
