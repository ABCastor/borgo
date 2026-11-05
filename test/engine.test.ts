import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/core/engine.ts";
import { resolve } from "../src/core/lookup.ts";
import { convert, money } from "../src/core/money.ts";
import { rightToLiveWork } from "../src/core/rights.ts";
import { shortestDay } from "../src/core/sun.ts";
import { fixture, profile } from "./fixture.ts";

const data = fixture();
const city = (id: string) => data.cities.find((c) => c.id === id)!;

test("rights: citizens, free-movement areas, and no right", () => {
  assert.equal(rightToLiveWork(data, { label: "a", citizenships: ["IT"] }, "IT").via, "citizen");
  assert.equal(rightToLiveWork(data, { label: "a", citizenships: ["IT"] }, "IE").via, "EU free movement");
  assert.equal(rightToLiveWork(data, { label: "a", citizenships: ["IE"] }, "GB").via, "Common Travel Area");
  assert.equal(rightToLiveWork(data, { label: "a", citizenships: ["IT"] }, "GB").allowed, false);
  assert.equal(rightToLiveWork(data, { label: "a", citizenships: ["GB"] }, "IT").allowed, false);
});

test("lookup prefers your override, then the most local level", () => {
  const p = profile({ overrides: { "dublin-ie": { pm25: 5 } } });
  assert.equal(resolve(data, p, city("dublin-ie"), "pm25")!.value, 5);
  const r = resolve(data, profile(), city("dublin-ie"), "pm25")!;
  assert.equal(r.value, 8);
  assert.equal(r.level, "city");
});

test("fx converts through the euro", () => {
  assert.equal(convert(data, 100, "EUR", "EUR"), 100);
  assert.ok(Math.abs(convert(data, 85, "GBP", "USD")! - 110) < 1e-9);
  assert.equal(convert(data, 1, "XXX", "EUR"), null);
});

test("money: net from the tax model, rent, everyday scaled by price level", () => {
  const m = money(data, profile(), city("dublin-ie"));
  assert.equal(m.localCurrency, "EUR");
  assert.ok(m.net! > 40_000 && m.net! < 47_000);
  assert.equal(m.rent!.monthly, 2200);
  assert.equal(m.everyday!.monthly, 900 * 1.25);
  assert.ok(Math.abs(m.monthlyLeft! - (m.net! / 12 - 2200 - 1125)) < 1e-6);
  assert.equal(m.runwayMonths, 20_000 / (2200 + 1125));
});

test("money: per-city offers are converted to local currency", () => {
  const p = profile({ income: { ...profile().income, mode: "per-city", perCity: { "london-gb": { gross: 100_000, currency: "EUR" } } } });
  const m = money(data, p, city("london-gb"));
  assert.equal(m.grossFrom, "per-city");
  assert.ok(Math.abs(m.gross! - 85_000) < 1e-6);
  assert.equal(m.localCurrency, "GBP");
  assert.ok(m.display.monthlyLeft !== null);
});

test("winter daylight is computed from latitude", () => {
  assert.ok(Math.abs(shortestDay(53.35) - 7.5) < 0.2); // Dublin ~7 h 30
  assert.ok(Math.abs(shortestDay(37.77) - 9.55) < 0.2); // San Francisco ~9 h 33
});

test("evaluate ranks, explains, and reports coverage", () => {
  const e = evaluate(data, profile());
  assert.equal(e.results.length, 4);
  for (const r of e.results) {
    const sum = r.lines.reduce((s, l) => s + l.points, 0);
    assert.ok(Math.abs(sum - r.total) < 1e-9);
    assert.ok(r.total >= 0 && r.total <= 100);
    assert.ok(r.coverage > 0 && r.coverage < 1, "some criteria have no data in the fixture");
  }
  assert.deepEqual(
    e.results.map((r) => r.rank),
    [1, 2, 3, 4],
  );
});

test("a deal-breaker moves failing cities to the bottom and names why", () => {
  const e = evaluate(data, profile({ dealBreakers: ["right_to_live"] }));
  const last = e.results.slice(-2).map((r) => r.city.id).sort();
  assert.deepEqual(last, ["london-gb", "san-francisco-us"]);
  assert.deepEqual(e.results.at(-1)!.ruledOut, ["Everyone can move there"]);
});

test("weights change the ranking; zero weight removes a line's influence", () => {
  const onlyAir = Object.fromEntries(
    ["money_left", "living_cost", "right_to_live", "climate_comfort", "winter_light", "sunshine", "dry_days", "safety", "long_life", "happiness", "builders"].map((k) => [k, 0]),
  );
  const e = evaluate(data, profile({ weights: { ...onlyAir, clean_air: 10 } }));
  assert.equal(e.results.at(-1)!.city.id, "turin-it"); // worst air
  assert.ok(e.results.every((r) => r.lines.filter((l) => l.id !== "clean_air").every((l) => l.points === 0)));
});

test("personal lines score like any other line", () => {
  const p = profile({
    weights: { money_left: 0, living_cost: 0, right_to_live: 0, climate_comfort: 0, winter_light: 0, clean_air: 0 },
    personal: [{ id: "family", label: "Family nearby", scores: { "turin-it": 5, "dublin-ie": 1, "london-gb": 1, "san-francisco-us": 1 } }],
  });
  assert.equal(evaluate(data, p).results[0]!.city.id, "turin-it");
});

test("relative scoring stretches the chosen cities from 0 to 1", () => {
  const e = evaluate(data, profile({ prefs: { comfort: { min: 12, max: 24 }, normalise: "relative", missing: "average" } }));
  const air = e.results.map((r) => r.lines.find((l) => l.id === "clean_air")!.score!);
  assert.equal(Math.min(...air), 0);
  assert.equal(Math.max(...air), 1);
});

test("sources that agree in level and time are consolidated into their median", () => {
  const d = fixture();
  d.sources.other = { ...d.sources.test!, id: "other" };
  d.sources.third = { ...d.sources.test!, id: "third" };
  d.observations["dublin-ie"]!.push(
    { metric: "pm25", value: 10, period: "2024", level: "city", source: "other", retrieved: "2026-10-27" },
    { metric: "pm25", value: 30, period: "2015", level: "city", source: "third", retrieved: "2026-10-27" },
  );
  const r = resolve(d, profile(), d.cities.find((c) => c.id === "dublin-ie")!, "pm25")!;
  assert.equal(r.origin.kind, "consensus");
  assert.equal(r.value, 9); // median of 8 (2025) and 10 (2024); the 2015 figure is too old to join
  if (r.origin.kind === "consensus") assert.deepEqual([r.origin.min, r.origin.max], [8, 10]);
  assert.ok(r.others.some((o) => o.source === "third"));
});

test("a city without a figure scores the lowest score a compared city has on that line; coverage counts only real data", () => {
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => o.metric !== "pm25");
  const weights = Object.fromEntries(["money_left", "living_cost", "right_to_live", "climate_comfort", "winter_light", "sunshine", "dry_days", "safety", "long_life", "happiness", "builders"].map((k) => [k, 0]));
  const e = evaluate(d, profile({ weights: { ...weights, clean_air: 10 } }));
  const dub = e.results.find((r) => r.city.id === "dublin-ie")!;
  const air = dub.lines.find((l) => l.id === "clean_air")!;
  assert.equal(air.imputed, true);
  assert.equal(air.observed, false);
  const others = e.results.filter((r) => r.city.id !== "dublin-ie").map((r) => r.lines.find((l) => l.id === "clean_air")!.score!);
  assert.equal(air.score, Math.min(...others));
  assert.equal(dub.coverage, 0);
  // "worst" scores the gap 0 and still counts it as no data.
  const worst = evaluate(d, profile({ weights: { ...weights, clean_air: 10 }, prefs: { comfort: { min: 12, max: 24 }, normalise: "absolute", missing: "worst" } }));
  const w = worst.results.find((r) => r.city.id === "dublin-ie")!;
  assert.equal(w.lines.find((l) => l.id === "clean_air")!.score, 0);
  assert.equal(w.coverage, 0);
  // "skip" leaves the line out for every city, so no city is scored on fewer lines than another.
  const skip = evaluate(d, profile({ weights: { ...weights, clean_air: 10 }, prefs: { comfort: { min: 12, max: 24 }, normalise: "absolute", missing: "skip" } }));
  assert.ok(skip.results.every((r) => r.lines.find((l) => l.id === "clean_air")!.score === null));
  assert.match(skip.notes.join(" "), /Clean air is left out for every city/);
});

test("the app's starting guess of where you live is never treated as your home", async () => {
  const { homeCity } = await import("../src/core/criteria.ts");
  const p = profile();
  p.income.everyday = { ...p.income.everyday!, assumed: true };
  assert.equal(homeCity(data, p), undefined);
  const m = money(data, p, city("turin-it"));
  assert.match(m.everyday!.how, /starting guess/);
  p.income.everyday.assumed = false;
  assert.equal(homeCity(data, p)?.id, "turin-it");
  assert.equal(money(data, p, city("turin-it")).everyday!.how, "your own spending");
});

test("engine: its version is package.json's, and every report names it with the snapshot and the exchange rates", async () => {
  const { ENGINE_VERSION } = await import("../src/core/engine.ts");
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(ENGINE_VERSION, pkg.version);
  const { dsInfo } = await import("../src/agent/report.ts");
  const d = { version: "v", builtAt: "b", fx: { date: "2026-11-04" } } as unknown as Parameters<typeof dsInfo>[0];
  assert.deepEqual(dsInfo(d), { version: "v", builtAt: "b", fxDate: "2026-11-04", engine: pkg.version });
});
