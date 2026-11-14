// Nice days a person defines: the temperature range, then rain, sky (sunshine), humidity, wind and daylight. Today's
// definition (dry and mostly clear) stays the default and reads the same bins, so no ranking moves until someone asks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { compareArgs } from "../src/cli/main.ts";
import { niceDays, niceTestsText } from "../src/core/criteria.ts";
import { evaluate, profileProblems } from "../src/core/engine.ts";
import { dayLength } from "../src/core/sun.ts";
import type { Hourly } from "../src/core/weather-days.ts";
import { BIN_COUNT, binsFromKinds, daylightShare, defaultTests, KIND, kindOf, niceBins, niceDaysByMonth, niceKinds, toDays } from "../src/core/weather-days.ts";
import { climateObservations } from "../src/fetch/open-meteo.ts";

/** Every day of 2023 with the same hours, except what `vary(day of year)` changes. */
function year(vary: (doy: number) => { precip?: number; cloud?: number; dew?: number; wind?: number; temp?: number }): Hourly {
  const h: Hourly = { time: [], temperature_2m: [], apparent_temperature: [], dew_point_2m: [], precipitation: [], snowfall: [], cloud_cover: [], wind_speed_10m: [] };
  for (let doy = 0; doy < 365; doy++) {
    const date = new Date(Date.UTC(2023, 0, 1 + doy)).toISOString().slice(0, 10);
    const v = vary(doy);
    for (let hr = 0; hr < 24; hr++) {
      h.time.push(`${date}T${String(hr).padStart(2, "0")}:00`);
      h.temperature_2m.push(v.temp ?? 22);
      h.apparent_temperature.push(v.temp ?? 22);
      h.dew_point_2m.push(v.dew ?? 10);
      h.precipitation.push(hr >= 9 && hr <= 20 ? (v.precip ?? 0) : 0);
      h.snowfall.push(0);
      h.cloud_cover.push(v.cloud ?? 20);
      h.wind_speed_10m.push(v.wind ?? 8);
    }
  }
  return h;
}

// A year whose days cycle through every kind: day 0 nice, 1 wet, 2 cloudy, 3 muggy, 4 windy, then again.
const CYCLE = [{}, { precip: 1 }, { cloud: 80 }, { dew: 20 }, { wind: 25 }];
const days = toDays(year((doy) => CYCLE[doy % 5]!));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("each day's kind names the nice-day tests it fails", () => {
  assert.deepEqual(days.slice(0, 5).map(kindOf), [0, KIND.wet, KIND.cloudy, KIND.muggy, KIND.windy]);
});

test("today's definition read from the days by kind equals the bins of dry, mostly clear days", () => {
  for (const basis of ["feels", "air"] as const) {
    const bins = niceBins(days, basis);
    const fromKinds = binsFromKinds(niceKinds(days, basis), {})!;
    assert.equal(fromKinds.length, 12 * BIN_COUNT);
    assert.ok(bins.every((b, i) => Math.abs(b - fromKinds[i]!) < 1e-9), basis);
  }
  assert.ok(defaultTests({}));
  assert.ok(defaultTests({ dry: true, clear: true }));
  assert.ok(!defaultTests({ calm: true }));
});

test("adding or dropping a test changes exactly the days it is about", () => {
  const k = niceKinds(days, "feels");
  const year = (t: Parameters<typeof binsFromKinds>[1]) => sum(niceDaysByMonth(binsFromKinds(k, t)!, 18, 30));
  // 365 days, one in five of each kind: 73 nice, muggy and windy days pass today's test too (they are dry and clear).
  assert.equal(Math.round(year({})), 73 * 3);
  assert.equal(Math.round(year({ notMuggy: true })), 73 * 2);
  assert.equal(Math.round(year({ notMuggy: true, calm: true })), 73);
  assert.equal(Math.round(year({ dry: false })), 73 * 4);
  assert.equal(Math.round(year({ dry: false, clear: false })), 365);
});

test("daylight is computed from the latitude: a long-day minimum keeps only the months with days that long", () => {
  const oslo = daylightShare(59.9, 12);
  assert.equal(oslo[0], 0, "no 12-hour day in an Oslo January");
  assert.equal(oslo[5], 1, "every June day is longer");
  assert.ok(oslo[2]! > 0 && oslo[2]! < 1, "March crosses 12 hours");
  const equator = daylightShare(0, 12);
  assert.ok(equator.every((x) => x === 1), "at the equator every day is just over 12 hours");
  assert.ok(dayLength(0, 0) > 12);
});

test("the fetcher publishes the days by kind for both temperatures, so a place fetched live can be asked anything", () => {
  const obs = climateObservations({ hourly: year((doy) => CYCLE[doy % 5]!) }, { period: "2023", years: 1, retrieved: "2026-11-14", url: "https://archive-api.open-meteo.com/" });
  for (const m of ["nice_kinds_feels", "nice_kinds_air"]) {
    const o = obs.find((x) => x.metric === m);
    assert.ok(o, m);
    assert.equal(o!.fetcher, "open-meteo-era5@4");
    assert.ok(Array.isArray(o!.value) && (o!.value.length - 12) % 2 === 0);
  }
});

const data = loadDataset();

test("the snapshot: every seed city has days by kind, and today's definition reads the same from both", () => {
  const p = buildProfile(data, { cities: data.cities.map((c) => c.id) }).profile;
  let worst = 0;
  for (const city of data.cities) {
    const bins = niceDays(data, p, city)!;
    assert.ok(bins, `${city.id}: no nice days`);
    // The same definition from the days by kind: dry and clear stated outright, which skips the bins.
    const k = data.observations[city.id]!.find((o) => o.metric === "nice_kinds_feels");
    assert.ok(k, `${city.id}: no nice_kinds_feels`);
    const fromKinds = sum(niceDaysByMonth(binsFromKinds(k!.value as number[], {})!, 18, 30));
    worst = Math.max(worst, Math.abs(fromKinds - sum(bins.months)));
  }
  assert.ok(worst < 0.05, `today's nice days from the two stores differ by up to ${worst.toFixed(2)} days a year`);
});

test("the engine ranks on the person's own nice day, says the definition, and leaves the default untouched", () => {
  const cities = ["Valencia", "Madrid"];
  const base = buildProfile(data, { cities, only: ["nice_days"] }).profile;
  const dry = buildProfile(data, { cities, only: ["nice_days"], comfort: { min: 18, max: 30, notMuggy: true } }).profile;
  const lead = (p: typeof base) => evaluate(data, p).results[0]!.city.id;
  const line = (p: typeof base, id: string) => evaluate(data, p).results.find((r) => r.city.id === id)!.lines.find((l) => l.id === "nice_days")!;
  // Valencia's summer is humid, Madrid's is not: leaving muggy days out turns the ranking round.
  assert.equal(lead(base), "valencia-es");
  assert.equal(lead(dry), "madrid-es");
  assert.ok(line(dry, "valencia-es").raw.value! < line(base, "valencia-es").raw.value! - 10);
  assert.ok(Math.abs(line(dry, "madrid-es").raw.value! - line(base, "madrid-es").raw.value!) < 2);
  assert.match(line(dry, "valencia-es").raw.text, /\(dry, mostly clear, not muggy\)$/);
  assert.doesNotMatch(line(base, "valencia-es").raw.text, /\(/, "the default says nothing extra");
  // Daylight needs no data: 13 hours or more leaves only the long months, in Madrid as anywhere.
  const long = buildProfile(data, { cities, only: ["nice_days"], comfort: { min: 18, max: 30, daylight: 13 } }).profile;
  assert.ok(line(long, "madrid-es").raw.value! < line(base, "madrid-es").raw.value!);
  assert.equal(niceTestsText({ min: 18, max: 30, dry: false, clear: false }), "any weather");
});

test("agents and the command line pass the tests; bad values are refused", () => {
  const a = compareArgs(["Lisbon"], { "nice-day": "not-muggy,calm,daylight=11,rain-ok" } as never);
  assert.deepEqual(a.comfort, { min: 18, max: 30, basis: "feels", notMuggy: true, calm: true, daylight: 11, dry: false });
  assert.throws(() => compareArgs(["Lisbon"], { "nice-day": "sunny" } as never), /use not-muggy, calm/);
  assert.throws(() => buildProfile(data, { cities: ["Lisbon"], comfort: { min: 18, max: 30, daylight: 30 } }), /comfort\.daylight is hours of daylight/);
  const ok = buildProfile(data, { cities: ["Lisbon"], comfort: { min: 18, max: 30, calm: true } });
  assert.ok(ok.assumptions.some((x) => /Nice days are dry, mostly clear, calm and feel 18 to 30/.test(x)));
});

test("a daylight minimum outside 0 to 24 hours is a problem", () => {
  const p = buildProfile(data, { cities: ["Lisbon"] }).profile;
  assert.deepEqual(profileProblems({ ...p, prefs: { ...p.prefs, comfort: { ...p.prefs.comfort, daylight: 12 } } }), []);
  assert.match(profileProblems({ ...p, prefs: { ...p.prefs, comfort: { ...p.prefs.comfort, daylight: 30 } } }).join(" "), /comfort\.daylight is hours of daylight, 0 to 24/);
});
