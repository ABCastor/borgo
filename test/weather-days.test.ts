import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/core/engine.ts";
import { DEFAULT_COMFORT, niceDays, upgradeProfile } from "../src/core/criteria.ts";
import { METRICS } from "../src/core/metrics.ts";
import { BIN_COUNT, BINS, DAY_SCORES, daysPerMonth, niceBins, niceDaysByMonth, quantile, RULES, toDays, type Hourly } from "../src/core/weather-days.ts";
import { climateObservations } from "../src/fetch/open-meteo.ts";
import { fixture, profile } from "./fixture.ts";

type HourValues = { temp: number; feels?: number; dew?: number; precip?: number; snow?: number; cloud?: number; wind?: number };

/** One synthetic local day: a value per clock hour, or one function of the hour for every variable. */
function day(date: string, at: (h: number) => HourValues, hours = 24): Hourly {
  const out: Hourly = { time: [], temperature_2m: [], apparent_temperature: [], dew_point_2m: [], precipitation: [], snowfall: [], cloud_cover: [], wind_speed_10m: [] };
  for (let h = 0; h < hours; h++) {
    const v = at(h);
    out.time.push(`${date}T${String(h).padStart(2, "0")}:00`);
    out.temperature_2m.push(v.temp);
    out.apparent_temperature.push(v.feels ?? v.temp);
    out.dew_point_2m.push(v.dew ?? 8);
    out.precipitation.push(v.precip ?? 0);
    out.snowfall.push(v.snow ?? 0);
    out.cloud_cover.push(v.cloud ?? 20);
    out.wind_speed_10m.push(v.wind ?? 10);
  }
  return out;
}

function join(...ds: Hourly[]): Hourly {
  const keys = Object.keys(ds[0]!) as (keyof Hourly)[];
  return Object.fromEntries(keys.map((k) => [k, ds.flatMap((d) => d[k] as unknown[])])) as unknown as Hourly;
}

/** Every day of 2023, each from `at(month, day of month, hour)`. */
function year(at: (month: number, dom: number, h: number) => HourValues): Hourly {
  const ds: Hourly[] = [];
  for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2024, 0, 1); t += 86_400_000) {
    const d = new Date(t);
    ds.push(day(d.toISOString().slice(0, 10), (h) => at(d.getUTCMonth(), d.getUTCDate(), h)));
  }
  return join(...ds);
}

const only = (h: Hourly) => {
  const d = toDays(h);
  assert.equal(d.length, 1);
  return d[0]!;
};
const passes = (metric: string, h: Hourly) => DAY_SCORES.find((s) => s.metric === metric)!.test(only(h));

/** A mild, dry, mostly clear spring day: 14 °C at night, 24 °C in the afternoon. */
const spring = (h: number): HourValues => ({ temp: 14 + 10 * Math.max(0, Math.sin(((h - 6) / 16) * Math.PI)) });

test("a day is reduced to its highs, lows and daytime means, 08:00 to 20:00", () => {
  const d = only(day("2023-05-10", (h) => ({ temp: h, feels: h + 1, cloud: h >= 8 && h <= 20 ? 30 : 100, wind: h >= 8 && h <= 20 ? 20 : 0 })));
  assert.equal(d.tmax, 23);
  assert.equal(d.tmin, 0);
  assert.equal(d.fmax, 24);
  assert.equal(d.dayAir, 14, "the mean of 8..20");
  assert.equal(d.dayFeels, 15);
  assert.equal(d.dayCloud, 30, "night cloud does not count");
  assert.equal(d.dayWind, 20);
  assert.equal(d.month, 4);
});

test("rain is read for the hour it fell: the 08:00 stamp is 07:00-08:00, outside the daytime", () => {
  assert.equal(only(day("2023-05-10", (h) => ({ ...spring(h), precip: h === 8 ? 5 : 0 }))).dayPrecip, 0);
  assert.equal(only(day("2023-05-10", (h) => ({ ...spring(h), precip: h === 9 ? 5 : 0 }))).dayPrecip, 5);
  assert.equal(only(day("2023-05-10", (h) => ({ ...spring(h), precip: h === 9 ? 5 : 0 }))).precip, 5);
});

test("an incomplete day is left out, a clock-change day is kept", () => {
  assert.equal(toDays(day("2023-05-10", spring, 20)).length, 0, "four hours missing");
  const gap = day("2023-05-10", spring);
  gap.cloud_cover[12] = null;
  assert.equal(toDays(gap).length, 0, "a daytime value missing");
  assert.equal(toDays(day("2023-03-26", spring, 23)).length, 1, "23 hours when the clocks go forward");
});

test("nice-day sky test: dry and at most half the sky clouded through the daytime", () => {
  const sky = (over: Partial<HourValues>) => {
    const d = only(day("2023-05-10", (h) => ({ ...spring(h), ...over })));
    return d.dayPrecip < RULES.dryMm && d.dayCloud <= RULES.niceCloud;
  };
  assert.ok(sky({}));
  assert.ok(sky({ cloud: 50 }), "half clouded still counts");
  assert.ok(!sky({ cloud: 51 }));
  assert.ok(!sky({ precip: 0.1 }), "0.1 mm every daytime hour is 1.2 mm");
  assert.ok(sky({ precip: 0.08 }), "0.96 mm of drizzle is still dry");
});

test("nice-day bins: summing a range gives that range's nice days, and the ends are open", () => {
  // Thirty June days: ten at 15 °C, ten at 22 °C, ten at 30 °C (constant all day), all dry and clear.
  const hours = join(
    ...Array.from({ length: 30 }, (_, i) => day(`2023-06-${String(i + 1).padStart(2, "0")}`, () => ({ temp: i < 10 ? 15 : i < 20 ? 22 : 30 }))),
  );
  const days = toDays(hours);
  const bins = niceBins(days, "air");
  assert.equal(bins.length, 12 * BIN_COUNT);
  assert.equal(niceDaysByMonth(bins, 18, 27)[5], 10);
  assert.equal(niceDaysByMonth(bins, 15, 30)[5], 30, "both ends included");
  assert.equal(niceDaysByMonth(bins, 16, 21)[5], 0);
  assert.equal(niceDaysByMonth(bins, -50, 15)[5], 10, "a minimum below the first bin takes everything colder");
  assert.equal(niceDaysByMonth(bins, 25, 99)[5], 10, "a maximum above the last bin takes everything hotter");
  assert.ok(niceDaysByMonth(bins, 18, 27).every((n, m) => m === 5 || Number.isNaN(n) || n === 0));
  assert.equal(BINS.from, -5);
});

test("nice days use the person's range and temperature live", () => {
  // Air 20 °C all day, but humid sun makes it feel 29 °C: nice in the air, too hot as felt.
  const hours = year((m) => (m === 5 ? { temp: 20, feels: 29 } : { temp: 5, cloud: 90 }));
  const obs = climateObservations({ hourly: hours }, { period: "2023-2023", years: 1, retrieved: "2026-10-27", url: "x" });
  const d = { ...fixture(), metrics: METRICS };
  d.observations["turin-it"] = obs;
  const city = d.cities.find((c) => c.id === "turin-it")!;
  const p = (c: typeof DEFAULT_COMFORT | { min: number; max: number; basis: "air" | "feels" }) => profile({ prefs: { comfort: { ...c }, normalise: "absolute", missing: "average" } });
  const upTo27 = { min: 18, max: 27, basis: "feels" } as const;
  assert.equal(niceDays(d, p(upTo27), city)!.months[5], 0, "29 °C felt is above 27");
  assert.equal(niceDays(d, p({ min: 18, max: 30, basis: "feels" }), city)!.months[5], 30);
  assert.equal(niceDays(d, p({ min: 18, max: 27, basis: "air" }), city)!.months[5], 30, "the air is 20 °C");
  const line = evaluate(d, p(upTo27)).results.find((r) => r.city.id === "turin-it")!.lines.find((l) => l.id === "nice_days")!;
  assert.equal(line.raw.value, 0);
  assert.match(line.raw.text, /nice days a year/);
  // The range a new profile starts with is 18 to 30 °C feels-like, so the 29 °C felt days count.
  assert.deepEqual({ ...DEFAULT_COMFORT }, { min: 18, max: 30, basis: "feels" });
  assert.equal(niceDays(d, p(DEFAULT_COMFORT), city)!.months[5], 30);
});

test("beach days: dry, at most 40% clouded, feeling 24 to 32 °C through the daytime", () => {
  const beach = (over: Partial<HourValues>) => passes("beach_days", day("2023-07-10", () => ({ temp: 26, feels: 28, cloud: 20, ...over })));
  assert.ok(beach({}));
  assert.ok(!beach({ cloud: 45 }), "nice-day sky, not beach sky");
  assert.ok(!beach({ feels: 23 }));
  assert.ok(!beach({ feels: 33 }));
  assert.ok(!beach({ precip: 1 }));
});

test("run or ride days: two dry, calm hours in a row between 6 am and 9 pm feeling 5 to 22 °C", () => {
  const hot = (h: number): HourValues => ({ temp: 30, feels: h === 6 || h === 7 ? 20 : 32 });
  assert.ok(passes("active_days", day("2023-07-10", hot)), "a cool early-morning window is enough");
  assert.ok(!passes("active_days", day("2023-07-10", (h) => ({ ...hot(h), feels: h === 6 ? 20 : 32 }))), "one hour is not a window");
  assert.ok(!passes("active_days", day("2023-07-10", (h) => ({ ...hot(h), precip: h === 7 || h === 8 ? 0.5 : 0 }))), "rain in the hour after spoils it");
  assert.ok(!passes("active_days", day("2023-07-10", (h) => ({ ...hot(h), wind: 35 }))), "too windy");
  assert.ok(!passes("active_days", day("2023-01-10", () => ({ temp: 0, feels: -3 }))), "too cold all day");
  assert.ok(!passes("active_days", day("2023-07-10", (h) => ({ temp: 30, feels: h === 3 || h === 4 ? 20 : 32 }))), "the cool hours are at night");
});

test("muggy days, grey days, hot nights, heat-stress days, snow days and windy days", () => {
  assert.ok(passes("muggy_days", day("2023-07-10", () => ({ temp: 28, dew: 18 }))));
  assert.ok(!passes("muggy_days", day("2023-07-10", () => ({ temp: 28, dew: 17.9 }))));
  assert.ok(passes("grey_days", day("2023-11-10", () => ({ temp: 8, cloud: 80 }))));
  assert.ok(!passes("grey_days", day("2023-11-10", (h) => ({ temp: 8, cloud: h === 12 ? 0 : 82 }))), "one clear hour lowers the mean under 80%");
  assert.ok(passes("hot_nights", day("2023-07-10", (h) => ({ temp: 20.5 + h / 2 }))));
  assert.ok(!passes("hot_nights", day("2023-07-10", (h) => ({ temp: 20 + h / 2 }))), "20 °C is not above 20");
  assert.ok(passes("hot_days", day("2023-07-10", (h) => ({ temp: 30, feels: h === 15 ? 32 : 28 }))));
  assert.ok(!passes("hot_days", day("2023-07-10", (h) => ({ temp: 30, feels: h === 22 ? 35 : 28 }))), "a hot night hour is not daytime");
  assert.ok(passes("snow_days", day("2023-01-10", (h) => ({ temp: -2, snow: h < 4 ? 0.25 : 0 }))));
  assert.ok(!passes("snow_days", day("2023-01-10", () => ({ temp: -2, snow: 0.04 }))));
  assert.ok(passes("windy_days", day("2023-01-10", () => ({ temp: 5, wind: 30 }))));
  assert.ok(!passes("windy_days", day("2023-01-10", (h) => ({ temp: 5, wind: h < 8 ? 60 : 20 }))), "a windy night is not a windy day");
});

test("days a month scale the passing share to the month's length, so a missing day is not a failed one", () => {
  const hours = join(...Array.from({ length: 31 }, (_, i) => day(`2023-01-${String(i + 1).padStart(2, "0")}`, () => ({ temp: 2, cloud: i % 2 ? 90 : 10 }), i === 0 ? 10 : 24)));
  const days = toDays(hours);
  assert.equal(days.length, 30, "1 January is incomplete");
  const grey = daysPerMonth(days, (d) => d.dayCloud >= 80);
  assert.equal(grey[0], (15 / 30) * 31);
  assert.ok(Number.isNaN(grey[1]!), "no February days read: no figure");
});

test("climate observations: spreads and extremes of daily highs and lows, and every score has a metric", () => {
  // July days with highs 21..30 and lows 11..20 (repeating every ten days), the rest of the year 5 °C.
  const hours = year((m, dom, h) => (m === 6 ? { temp: h === 15 ? 21 + ((dom - 1) % 10) : 11 + ((dom - 1) % 10) } : { temp: 5 }));
  const obs = climateObservations({ hourly: hours }, { period: "2023-2023", years: 1, retrieved: "2026-10-27", url: "x" });
  const v = (m: string) => (obs.find((o) => o.metric === m)?.value as number[] | undefined)?.[6];
  const july = Array.from({ length: 31 }, (_, i) => 21 + (i % 10));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(v("temp_high"), round(mean(july)));
  assert.equal(v("temp_low"), round(mean(july) - 10));
  assert.equal(v("temp_record_high"), 30);
  assert.equal(v("temp_record_low"), 11);
  assert.equal(v("temp_high_p90"), round(quantile(july, 0.9)));
  assert.equal(v("temp_low_p10"), round(quantile(july, 0.1) - 10));
  for (const s of DAY_SCORES) assert.ok(obs.some((o) => o.metric === s.metric) && METRICS[s.metric], s.metric);
  for (const o of obs) assert.ok(METRICS[o.metric], o.metric);
});

test("a series with a month nobody could read is not published", () => {
  const hours = join(...Array.from({ length: 10 }, (_, i) => day(`2023-07-${String(i + 1).padStart(2, "0")}`, () => ({ temp: 20 }))));
  const obs = climateObservations({ hourly: hours }, { period: "2023-2023", years: 1, retrieved: "2026-10-27", url: "x" });
  assert.ok(!obs.some((o) => o.metric === "temp_high" || o.metric === "beach_days"));
});

test("an old saved profile moves from comfortable months to nice days once", () => {
  const p = profile({ weights: { climate_comfort: 12 }, dealBreakers: ["climate_comfort"] });
  upgradeProfile(p);
  assert.deepEqual(p.prefs.comfort, { ...DEFAULT_COMFORT });
  assert.equal(p.weights.nice_days, 12);
  assert.ok(!("climate_comfort" in p.weights));
  assert.deepEqual(p.dealBreakers, ["nice_days"]);
  p.prefs.comfort = { min: 16, max: 25, basis: "air" };
  upgradeProfile(p);
  assert.deepEqual(p.prefs.comfort, { min: 16, max: 25, basis: "air" }, "a current range is left alone");
});

const round = (n: number) => Math.round(n * 10) / 10;
