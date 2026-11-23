import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { rankCities, rankingMarkdown } from "../src/agent/rank.ts";
import { compare } from "../src/agent/report.ts";
import { evaluate } from "../src/core/engine.ts";
import { niceDays } from "../src/core/criteria.ts";
import { resolve } from "../src/core/lookup.ts";
import { convert, money } from "../src/core/money.ts";

const data = loadDataset(undefined, { cache: false });
const ids = ["lisbon-pt", "berlin-de", "turin-it"];

test("ranking: nice days equal the engine and keep monthly inputs and citations", () => {
  for (const comfort of [undefined, { min: 20, max: 28, basis: "air" as const, dry: false, clear: false }]) {
    const r = rankCities(data, { criterion: "nice_days", cities: ids, comfort });
    const report = compare(data, { cities: ids, only: ["nice_days"], comfort });
    assert.equal(r.rows.length, 3);
    for (const row of r.rows) {
      assert.equal(row.value, report.cities.find((c) => c.id === row.id)!.lines.find((l) => l.id === "nice_days")!.value);
      assert.equal(row.months?.length, 12);
      assert.ok(row.sources.some((s) => s.id === "open-meteo-era5" && s.year));
    }
    assert.ok(r.rows[0]!.value >= r.rows[1]!.value);
  }
});

test("ranking: every priority line has the same raw values as its engine recipe, without fallbacks", () => {
  const report = compare(data, { cities: ids, salary: { amount: 80000, currency: "EUR" }, stances: { politics: 5 } });
  for (const line of report.cities[0]!.lines.filter((l) => !l.personal)) {
    const r = rankCities(data, { cities: ids, criterion: line.id, salary: { amount: 80000, currency: "EUR" }, stances: { politics: 5 } });
    for (const row of r.rows) {
      const l = report.cities.find((c) => c.id === row.id)!.lines.find((l) => l.id === line.id)!;
      // The report can use a scoring fallback. A raw query must never inherit it.
      if (!l.basis) assert.equal(row.value, l.value, line.id);
    }
  }
});

test("ranking: scalar currency metrics convert before sorting and filtering", () => {
  const r = rankCities(data, { metric: "rent_1bed", cities: ["london-gb", "turin-it", "tokyo-jp"], displayCurrency: "EUR", order: "asc" });
  assert.equal(r.rows.length, 3);
  for (const row of r.rows) {
    const city = data.cities.find((c) => c.id === row.id)!;
    const rent = resolve(data, null, city, "rent_1bed")!.value as number;
    assert.equal(row.value, convert(data, rent, data.countries[city.country]!.currency, "EUR"));
    assert.equal(row.unit, "EUR/month");
    assert.ok(row.sources.length);
  }
  assert.ok(r.rows[0]!.value <= r.rows[1]!.value);
  const cutoff = r.rows[1]!.value;
  const filtered = rankCities(data, { metric: "rent_1bed", cities: r.rows.map((x) => x.id), filters: { ranges: [{ metric: "rent_1bed", max: cutoff }] }, displayCurrency: "EUR" });
  assert.equal(filtered.rows.length, 2);
  const d = structuredClone(data);
  d.cities.find((c) => c.id === "turin-it")!.country = "XX";
  const unknownCurrency = rankCities(d, { metric: "rent_1bed", cities: ["turin-it"] });
  assert.equal(unknownCurrency.rows.length, 0);
  assert.equal(unknownCurrency.coverage.missing, 1);
});

test("ranking: geographic, population, metric and established-household-right filters compose", () => {
  const r = rankCities(data, { metric: "rent_1bed", order: "asc", household: [{ passports: ["IT"] }], filters: { region: "europe", population: { min: 100000 }, rightToLive: true, ranges: [{ metric: "sunshine_hours", min: 2500 }] } });
  assert.ok(r.rows.length > 0);
  for (const row of r.rows) {
    const city = data.cities.find((c) => c.id === row.id)!;
    assert.ok(city.population! >= 100000);
    assert.ok((resolve(data, null, city, "sunshine_hours")!.value as number) >= 2500);
    assert.notEqual(city.country, "GB");
  }
  const country = rankCities(data, { criterion: "nice_days", filters: { countries: ["it"], subdivision: "IT-21" } });
  assert.ok(country.rows.length > 0);
  assert.ok(country.rows.every((r) => r.country === "IT"));
  const unknown = rankCities(data, { criterion: "nice_days", filters: { rightToLive: true } });
  assert.equal(unknown.rows.length, 0);
  assert.equal(unknown.coverage.filterUnknown, data.cities.length);
});

test("ranking: gaps are counted, never invented, and missing filter values do not pass", () => {
  const d = structuredClone(data);
  for (const id of ids.slice(0, 2)) d.observations[id] = d.observations[id]!.filter((o) => o.metric !== "sunshine_hours");
  const r = rankCities(d, { metric: "sunshine_hours", cities: ids });
  assert.equal(r.rows.length, 1);
  assert.equal(r.coverage.missing, 2);
  assert.deepEqual(r.coverage.missingIds.sort(), ids.slice(0, 2).sort());
  const filtered = rankCities(d, { criterion: "nice_days", cities: ids, filters: { ranges: [{ metric: "sunshine_hours", min: 0 }] } });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.coverage.filterUnknown, 2);
  assert.equal(filtered.coverage.missing, 0);
});

test("ranking: monthly metrics need explicit semantics; month strips retain the twelve values", () => {
  assert.throws(() => rankCities(data, { metric: "temp_high" }), /choose aggregate or month/);
  for (const aggregate of ["mean", "sum", "min", "max"] as const) {
    const r = rankCities(data, { metric: "temp_high", cities: ids, aggregate, view: "months" });
    const xs = r.rows[0]!.months!;
    const expected = aggregate === "mean" ? xs.reduce((a, b) => a + b, 0) / 12 : aggregate === "sum" ? xs.reduce((a, b) => a + b, 0) : aggregate === "min" ? Math.min(...xs) : Math.max(...xs);
    assert.equal(r.rows[0]!.value, expected);
  }
  const r = rankCities(data, { criterion: "nice_days", cities: ids, month: 7 });
  assert.equal(r.rows[0]!.value, r.rows[0]!.months![6]);
  assert.equal(r.rows[0]!.unit, "days/month");
});

test("ranking: after tax and rent uses supported tax and real rent, and does not pretend other costs count", () => {
  const args = { cities: ids, salary: { amount: 80000, currency: "EUR" } };
  const { profile } = buildProfile(data, args);
  const r = rankCities(data, { ...args, criterion: "after_tax_rent" });
  assert.equal(r.rows.length, 3);
  for (const row of r.rows) {
    const m = money(data, profile, data.cities.find((c) => c.id === row.id)!);
    assert.equal(row.value, convert(data, m.net! / 12 - m.rent!.monthly, m.localCurrency, profile.displayCurrency));
    assert.ok(row.sources.some((s) => s.id.startsWith("tax:")));
    assert.match(row.notes.join(" "), /not subtracted/);
  }
  assert.equal(rankCities(data, { cities: ids, criterion: "after_tax_rent" }).rows.length, 0);
  assert.equal(rankCities(data, { ...args, criterion: "money_left" }).rows.length, 0, "no spending is not zero spending");
});

test("ranking: overall score preserves engine values, coverage and must-pass grouping", () => {
  const args = { cities: ids, only: ["nice_days", "right_to_live"], household: [{ passports: ["IT"] }], dealBreakers: ["right_to_live"] };
  const { profile } = buildProfile(data, args);
  const evaluation = evaluate(data, profile);
  const r = rankCities(data, { ...args, score: true });
  assert.deepEqual(r.rows.map((x) => x.id), evaluation.results.map((x) => x.city.id));
  for (const row of r.rows) {
    const result = evaluation.results.find((x) => x.city.id === row.id)!;
    assert.equal(row.value, result.total);
    assert.equal(row.coverage, result.requestedCoverage);
    assert.ok(row.sources.some((s) => s.id === "borgo-engine"));
  }
});

test("ranking: compact text fallback contains values, source ids and periods, coverage and a working city-list link", () => {
  const r = rankCities(data, { criterion: "nice_days", limit: 3 });
  const text = rankingMarkdown(r);
  assert.match(text, /\| # \| City \| Value \| Unit \| Source and year \|/);
  assert.match(text, /open-meteo-era5/);
  assert.match(text, /2021-2025/);
  assert.match(text, /57 known cities/);
  assert.deepEqual(new URL(r.link).searchParams.get("cities")!.split(","), r.rows.map((x) => x.id));
  assert.equal(r.rows.length, 3);
  assert.equal(r.coverage.matched, 57);
  assert.doesNotMatch(text, /—/);
});

test("ranking: local fetched places keep their original names in a private-input-free share link", () => {
  const d = structuredClone(data);
  d.publishedCityIds = d.cities.filter((c) => c.id !== "malaga-es").map((c) => c.id);
  const r = rankCities(d, { criterion: "nice_days", cities: ["malaga-es"], salary: { amount: 80000, currency: "EUR" }, household: [{ passports: ["IT"] }] });
  const encoded = new URL(r.link).hash.replace("#share=", "");
  const share = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(share).sort(), ["cities", "places"]);
  assert.deepEqual(share.places, { "malaga-es": "Málaga, ES" });
});

test("ranking: a real zero remains a figure, consensus keeps all source ids, and all-tenancy rent keeps its caveat", () => {
  const d = structuredClone(data);
  d.observations["turin-it"] = [
    { metric: "rent_1bed", value: 800, source: "ons-rent", period: "2025", retrieved: "2026-11-23", level: "city" },
    { metric: "rent_1bed", value: 1000, source: "de-zensus", period: "2025", retrieved: "2026-11-23", level: "city" },
  ];
  const r = rankCities(d, { metric: "rent_1bed", cities: ["turin-it"] });
  assert.equal(r.rows[0]!.value, 900);
  assert.equal(r.rows[0]!.sources.length, 2);
  assert.match(r.rows[0]!.notes.join(" "), /all tenancies; newcomers usually pay more/);
  const own = rankCities(d, { metric: "rent_1bed", cities: ["turin-it"], overrides: { "turin-it": { rent_1bed: 0 } } });
  assert.equal(own.rows[0]!.value, 0);
  assert.equal(own.coverage.missing, 0);
  assert.equal(own.rows[0]!.sources[0]!.id, "you");
});

test("ranking: malformed measures fail clearly rather than silently changing the question", () => {
  for (const args of [{ metric: "invented" }, { criterion: "invented" }, { metric: "rent_1bed", criterion: "nice_days" }, { metric: "nice_bins_air", aggregate: "sum" as const }, { metric: "rent_1bed", month: 1 }, { criterion: "nice_days", month: 13 }, { criterion: "nice_days", comfort: { min: 30, max: 10 } }]) assert.throws(() => rankCities(data, args));
});
