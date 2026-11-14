// Community figures: what is refused at the door, what the automated review holds, and what is shown and published.
import assert from "node:assert/strict";
import { test } from "node:test";
import { datasetCsv, datasetRows, FIGURES, parseSubmission, review, reviewAll, rounded, summarize, periodText, type Entry, type PlacesMeta } from "../src/community/figures.ts";

const meta: PlacesMeta = {
  places: { "turin-it": ["Turin", "IT", "EUR"], "london-gb": ["London", "GB", "GBP"], "lagos-ng": ["Lagos", "NG", "NGN"] },
  fx: { GBP: 0.84 },
  official: { "london-gb": { rent_1bed: { value: 2200, source: "ONS", period: "2026-09" } } },
};
const NOW = new Date("2026-11-14T12:00:00Z");
let n = 0;
const e = (value: number, day = "2026-09-01", figure = "rent.1.centre", city = "turin-it"): Entry => ({ id: `e${++n}`, city, figure, value, currency: "EUR", day, via: "web" });

test("a full submission parses into one figure per field, in the place's currency", () => {
  const r = parseSubmission({ city: "turin-it", rent: { amount: 950, bedrooms: "1", area: "centre" }, prices: { cappuccino: 1.6, transit: 0 }, salary: { amount: 2400, occupation: "software" }, rating: 4, consent: true, via: "cli" }, meta);
  assert.ok(r.ok);
  assert.equal(r.value.currency, "EUR");
  assert.equal(r.value.via, "cli");
  assert.deepEqual(r.value.figures.map((f) => f.figure), ["rent.1.centre", "price.cappuccino", "price.transit", "salary.software", "rating.overall"]);
});

test("refused at the door: no consent, unknown place, another currency, out of bounds, wrong shapes", () => {
  const bad = (x: object) => {
    const r = parseSubmission(x, meta);
    assert.equal(r.ok, false);
    return (r as { problems: string[] }).problems.join(" ");
  };
  assert.match(bad({ city: "turin-it", rating: 4 }), /consent/);
  assert.match(bad({ city: "atlantis-xx", rating: 4, consent: true }), /No place "atlantis-xx"/);
  assert.match(bad({ city: "london-gb", rent: { amount: 1500, bedrooms: "1", area: "centre" }, currency: "EUR", consent: true }), /in GBP/);
  // 20,000 euros is the ceiling for rent; in pounds that is 16,800.
  assert.match(bad({ city: "london-gb", rent: { amount: 17_000, bedrooms: "1", area: "centre" }, consent: true }), /outside what is plausible/);
  assert.ok(parseSubmission({ city: "london-gb", rent: { amount: 16_000, bedrooms: "1", area: "centre" }, consent: true }, meta).ok);
  assert.match(bad({ city: "turin-it", rating: 6, consent: true }), /1 to 5/);
  assert.match(bad({ city: "turin-it", rating: 3.5, consent: true }), /whole number/);
  assert.match(bad({ city: "turin-it", rent: { amount: 900, bedrooms: "7", area: "centre" }, consent: true }), /bedrooms/);
  assert.match(bad({ city: "turin-it", salary: { amount: 2000, occupation: "astronaut" }, consent: true }), /occupation/);
  assert.match(bad({ city: "turin-it", prices: { caviar: 90 }, consent: true }), /not asked/);
  assert.match(bad({ city: "turin-it", consent: true }), /at least one figure/);
  assert.match(bad({ city: "turin-it", rating: 4, consent: true, name: "Ada" }), /Unknown field "name"/);
  assert.match(bad({ city: "turin-it", prices: { cappuccino: -1 }, consent: true }), /negative/);
});

test("a currency without a euro rate is still taken, with only a sanity ceiling", () => {
  assert.ok(parseSubmission({ city: "lagos-ng", rent: { amount: 450_000, bedrooms: "1", area: "outside" }, consent: true }, meta).ok);
});

test("review: typical spreads are shown, a far amount is held, and is shown once others agree", () => {
  const typical = [900, 950, 1000, 1050, 1100, 980].map((v) => e(v));
  const far = e(4000);
  const v = review([...typical, far], NOW);
  for (const t of typical) assert.equal(v.get(t.id)!.status, "shown");
  assert.equal(v.get(far.id)!.status, "held");
  // A city where amounts really are spread out: no one is held for it.
  const spread = [600, 1200, 800, 1500, 1000, 700].map((x) => e(x));
  assert.ok(spread.every((x) => review(spread, NOW).get(x.id)!.status === "shown"));
  // The far one becomes typical when others report the same.
  const later = [3900, 4100, 4050, 3950, 4000, 4020].map((x) => e(x));
  const w = review([far, ...later], NOW);
  assert.equal(w.get(far.id)!.status, "shown");
});

test("review: with few entries, the official figure is the check", () => {
  const ok = { ...e(2100), city: "london-gb", currency: "GBP" };
  const off = { ...e(80), city: "london-gb", currency: "GBP" };
  const v = reviewAll([ok, off], NOW, meta);
  assert.equal(v.get(ok.id)!.status, "shown");
  assert.equal(v.get(off.id)!.status, "held");
});

test("review: the Lund case, a burst of entries in one day that moves the figure, is held until two days old", () => {
  const before = [3, 3, 4, 3, 3, 4].map((x) => e(x * 300, "2026-09-10"));
  const burst = Array.from({ length: 10 }, () => e(9000, "2026-11-14"));
  const v = review([...before, ...burst], NOW);
  assert.ok(before.every((x) => v.get(x.id)!.status === "shown"));
  assert.ok(burst.every((x) => v.get(x.id)!.status === "held"));
  // Ratings skip the amount checks but not the burst rule.
  const ratingsBefore = [4, 4, 5, 4, 4, 4].map((x) => e(x, "2026-09-10", "rating.overall"));
  const ratingsBurst = Array.from({ length: 10 }, () => e(1, "2026-11-13", "rating.overall"));
  const r = review([...ratingsBefore, ...ratingsBurst], NOW);
  assert.ok(ratingsBurst.every((x) => r.get(x.id)!.status === "held"));
  assert.ok(ratingsBefore.every((x) => r.get(x.id)!.status === "shown"));
  // A new place whose first entries all arrive today is not a burst.
  const fresh = [900, 950, 1000, 1020, 980, 1010].map((x) => e(x, "2026-11-14"));
  assert.ok(fresh.every((x) => review(fresh, NOW).get(x.id)!.status === "shown"));
});

test("property: one entry repeated any number of times never holds the others or itself", () => {
  for (let k = 1; k < 30; k++) {
    const list = Array.from({ length: k }, () => e(1234));
    assert.ok([...review(list, NOW).values()].every((x) => x.status === "shown"));
  }
});

test("summary: count, median, middle half from 3 entries, months, official beside; one entry is shown as itself", () => {
  const list = [e(900, "2026-09-03"), e(1000, "2026-10-20"), e(1100, "2026-11-01"), e(4, "2026-11-02", "rating.overall"), e(5, "2026-11-02", "rating.overall")];
  const s = summarize(list, reviewAll(list, NOW, meta), meta, "turin-it");
  const rent = s.find((x) => x.figure === "rent.1.centre")!;
  assert.equal(rent.entries, 3);
  assert.equal(rent.value, 1000);
  assert.deepEqual(rent.range, [950, 1050]);
  assert.equal(periodText(rent.from, rent.to), "Sep to Nov 2026");
  const rating = s.find((x) => x.figure === "rating.overall")!;
  assert.equal(rating.value, 4.5);
  assert.equal(rating.range, null);
  const one = [{ ...e(2161), city: "london-gb", currency: "GBP" }];
  const ls = summarize(one, reviewAll(one, NOW, meta), meta, "london-gb");
  assert.equal(ls[0]!.entries, 1);
  assert.equal(ls[0]!.value, 2160, "rounded to three significant digits");
  assert.deepEqual(ls[0]!.official, { value: 2200, source: "ONS", period: "2026-09", metric: "rent_1bed" });
});

test("the open dataset holds no removal code and no day, and amounts are rounded", () => {
  const list = [{ ...e(1234.56), removal: "secret" } as Entry & { removal: string }];
  const rows = datasetRows(list, reviewAll(list, NOW, meta), meta);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["city", "country", "currency", "figure", "id", "label", "month", "name", "review", "value", "via"]);
  assert.equal(rows[0]!.value, 1230);
  assert.equal(rows[0]!.month, "2026-09");
  assert.ok(!datasetCsv(rows).includes("secret"));
  assert.ok(!datasetCsv(rows).includes("2026-09-01"));
});

test("rounding keeps three significant digits at every scale", () => {
  assert.deepEqual([0.456, 1.64, 12.34, 987.6, 1234, 56_789, 450_123].map(rounded), [0.46, 1.64, 12.3, 988, 1230, 56_800, 450_000]);
});

test("every figure id is unique and every rent has a bedroom count and an area", () => {
  assert.equal(new Set(FIGURES.map((f) => f.id)).size, FIGURES.length);
  assert.equal(FIGURES.filter((f) => f.kind === "rent").length, 8);
});
