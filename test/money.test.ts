// The household's money: a salary per person (and per city), pension, children, family costs from open data, paid
// leave, and the break-even salary.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/core/engine.ts";
import { ageExtraLeave, breakEven, money } from "../src/core/money.ts";
import { moneyGap } from "../src/core/criteria.ts";
import { METRICS } from "../src/core/metrics.ts";
import type { Dataset, Observation } from "../src/core/types.ts";
import { makeCtx } from "../src/fetch/context.ts";
import { labourLaw, nagerHolidays, nccObservations, oecdChildcare, STATUTORY_LEAVE } from "../src/fetch/family.ts";
import { TAX_MODELS } from "../src/tax/index.ts";
import { NAGER_IT, NCC_CSV } from "./fake-network.ts";
import { fixture, profile } from "./fixture.ts";

const o = (metric: string, value: number, level: Observation["level"] = "country"): Observation => ({ metric, value, period: "2026", level, source: "test", retrieved: "2026-11-05" });
const city = (d: Dataset, id: string) => d.cities.find((c) => c.id === id)!;

function data(): Dataset {
  const d = fixture();
  d.metrics = METRICS;
  d.observations["turin-it"]!.push(o("childcare_net_couple_1", 1_200), o("childcare_net_couple_2", 2_000), o("childcare_net_single_1", 600), o("health_oop", 800), o("annual_leave", 20), o("public_holidays", 7), o("leave_mothers", 31.7), o("leave_fathers", 5.9));
  d.observations["san-francisco-us"]!.push(o("childcare_net_couple_1", 13_000), o("childcare_net_couple_2", 25_000), o("health_oop", 1_500), o("annual_leave", 0), o("public_holidays", 11));
  d.observations["london-gb"]!.push(o("health_oop", 850), o("annual_leave", 20));
  return d;
}

test("a second earner's pay counts, taxed on its own where the country taxes people separately", () => {
  const d = data();
  const solo = money(d, profile(), city(d, "turin-it"));
  const p = profile();
  p.household[1]!.pay = { gross: 30_000, currency: "EUR" };
  const two = money(d, p, city(d, "turin-it"));
  assert.equal(two.earners.length, 2);
  assert.equal(two.gross, 90_000);
  assert.ok(two.net! > solo.net! + 20_000);
  assert.ok(two.tax!.lines.some((l) => l.label.startsWith("Partner: ")));
  // Each earner's own take-home adds up to the household's.
  assert.ok(Math.abs(two.earners[0]!.net! + two.earners[1]!.net! - two.net!) < 0.1);
  assert.equal(two.filing, null, "not married: no filing note");
});

test("a partner's pay can differ by city, like your own", () => {
  const d = data();
  const p = profile();
  p.household[1]!.pay = { gross: 30_000, currency: "EUR", mode: "per-city", perCity: { "london-gb": { gross: 50_000, currency: "GBP" } } };
  const london = money(d, p, city(d, "london-gb"));
  const turin = money(d, p, city(d, "turin-it"));
  assert.equal(london.earners[1]!.gross, 50_000);
  assert.equal(london.earners[1]!.grossFrom, "per-city");
  assert.equal(turin.earners[1]!.gross, 30_000);
});

test("a married couple in the US files jointly when it is cheaper, and the filing says so", () => {
  const d = data();
  const p = profile({ income: { ...profile().income, gross: 150_000, currency: "USD" } });
  p.household[1]!.spouse = true;
  p.household[1]!.pay = { gross: 10_000, currency: "USD" };
  const m = money(d, p, city(d, "san-francisco-us"));
  assert.equal(m.filing?.mode, "joint");
  assert.ok(m.tax!.lines.some((l) => l.label.includes("Federal income tax, joint return")));
});

test("a married couple on one income still files jointly where that is cheaper", () => {
  const d = data();
  const p = profile({ income: { ...profile().income, gross: 150_000, currency: "USD" } });
  p.household[1]!.spouse = true;
  const m = money(d, p, city(d, "san-francisco-us"));
  assert.equal(m.filing?.mode, "joint");
  assert.equal(m.earners.length, 2);
  assert.equal(m.gross, 150_000);
  const single = money(d, { ...p, household: [p.household[0]!, { ...p.household[1]!, spouse: false }] }, city(d, "san-francisco-us"));
  assert.ok(m.net! > single.net! + 1_000, `${m.net} vs ${single.net}`);
});

test("pension: the contribution leaves take-home pay and the relief lowers the tax", () => {
  const d = data();
  const p = profile({ income: { ...profile().income, pension: 0.05 } });
  const m = money(d, p, city(d, "turin-it"));
  const base = money(d, profile(), city(d, "turin-it"));
  assert.equal(m.pension, 3_000);
  // Italy deducts the contribution: take-home falls by less than the contribution.
  assert.ok(base.net! - m.net! < 3_000 && base.net! - m.net! > 1_500, `${base.net! - m.net!}`);
});

test("childcare after public support, for children under 6, for a couple or a single parent", () => {
  const d = data();
  const couple = profile({ children: [2, 8] });
  couple.household[1]!.relation = "partner";
  const m = money(d, couple, city(d, "turin-it"));
  assert.equal(m.childcare!.monthly, 100);
  assert.match(m.childcare!.how, /couple/);
  const two = money(d, { ...couple, children: [1, 3, 4] }, city(d, "turin-it"));
  // Past two children, each is counted at the cost of the second: 2,000 + 800.
  assert.ok(Math.abs(two.childcare!.monthly - 2_800 / 12) < 1e-9);
  const single = money(d, profile({ household: [{ label: "Me", citizenships: ["IT"] }], children: [3] }), city(d, "turin-it"));
  assert.equal(single.childcare!.monthly, 50);
  // No figure: childcare is named as left out, never counted as free: money left is there but partial, so it is
  // not scored as a whole figure.
  const dublin = money(d, couple, city(d, "dublin-ie"));
  assert.ok(!dublin.missing.includes("childcare"));
  assert.ok(dublin.completeness.missing.some((o) => o.startsWith("childcare")));
  assert.equal(dublin.completeness.status, "partial");
  assert.ok(moneyGap(dublin));
  assert.notEqual(dublin.monthlyLeft, null);
  // Three children with a two-child figure but no one-child figure: the third child's cost is unknown, not zero.
  const onlyTwo = data();
  onlyTwo.observations["turin-it"] = onlyTwo.observations["turin-it"]!.filter((o) => o.metric !== "childcare_net_couple_1");
  const three = money(onlyTwo, { ...couple, children: [1, 3, 4] }, city(onlyTwo, "turin-it"));
  assert.equal(three.childcare, null);
  assert.equal(three.completeness.status, "partial");
  // Older children need no childcare.
  assert.equal(money(d, profile({ children: [9] }), city(d, "turin-it")).childcare, null);
});

test("health: each person at the country's out-of-pocket average, and premiums named where cover is bought separately", () => {
  const d = data();
  const p = profile({ children: [4] });
  const m = money(d, p, city(d, "san-francisco-us"));
  // Three people at $1,500 a year, in dollars.
  assert.ok(Math.abs(m.health!.monthly - (3 * 1_500) / 12) < 1e-9);
  assert.ok(m.gaps.some((g) => /premiums/.test(g)));
  const own = profile({ overrides: { "san-francisco-us": { health_premium: 600 } } });
  assert.ok(money(d, own, city(d, "san-francisco-us")).gaps.every((g) => !/premiums/.test(g)));
  // Turin: euros converted from dollars, two people.
  const t = money(d, profile(), city(d, "turin-it"));
  assert.ok(Math.abs(t.health!.monthly - ((800 / 1.1) * 2) / 12) < 1e-6);
  // Health and childcare are part of the month's cost.
  assert.ok(Math.abs(t.monthlyCost! - (t.rent!.monthly + t.everyday!.monthly + t.health!.monthly)) < 1e-9);
});

test("leave: holiday by law, public holidays and parental leave, with age rules and a value at your pay", () => {
  const d = data();
  const m = money(d, profile(), city(d, "turin-it"));
  assert.equal(m.leave.holiday, 20);
  assert.equal(m.leave.publicHolidays, 7);
  assert.equal(m.leave.mothers, 31.7);
  assert.ok(Math.abs(m.leave.value! - (60_000 / 260) * 27) < 1e-6);
  assert.deepEqual(ageExtraLeave("HU", 30), { days: 2, note: "2 more days at your age (Labour Code § 117)" });
  assert.equal(ageExtraLeave("HU", 24), null);
  assert.equal(ageExtraLeave("NO", 61)?.days, 5);
  assert.equal(ageExtraLeave("IT", 61), null);
  for (const cc of Object.keys(TAX_MODELS)) assert.ok(STATUTORY_LEAVE[cc], `${cc}: no statutory leave`);
});

test("UK statutory leave includes bank holidays rather than adding them twice", () => {
  const d = data();
  const observations = d.observations["london-gb"]!;
  observations.find((x) => x.metric === "annual_leave")!.value = 28;
  observations.push(o("public_holidays", 9));
  const result = money(d, profile(), city(d, "london-gb"));
  assert.equal(result.leave.holiday, 28);
  assert.equal(result.leave.publicHolidays, 9);
  assert.match(result.leave.holidayNote!, /not added again/);
  // Work out the daily value from the same city's actual local gross.
  const gross = result.earners[0]!.gross;
  assert.ok(gross !== null);
  assert.ok(Math.abs(result.leave.value! - gross / 260 * 28) < 1e-6);
});

test("break-even: the gross that keeps what you keep at home, found over the whole tax model", () => {
  const d = data();
  const p = profile();
  const home = money(d, p, city(d, "turin-it"));
  const be = breakEven(d, p, city(d, "london-gb"), home, "turin-it")!;
  assert.ok(be.gross > 0);
  // At that gross, London leaves what Turin leaves, to within a pound a month.
  const at = money(d, { ...p, income: { ...p.income, mode: "per-city", perCity: { "london-gb": { gross: be.gross, currency: "GBP" } } } }, city(d, "london-gb"));
  const target = home.monthlyLeft! * 0.85;
  assert.ok(Math.abs(at.monthlyLeft! - target) < 1, `${at.monthlyLeft} vs ${target}`);
  assert.equal(breakEven(d, p, city(d, "turin-it"), home, "turin-it"), null, "no break-even at home");
  // The engine puts it on each city, against where you live now; a starting guess is not a home.
  const ev = evaluate(d, p);
  assert.ok(ev.results.find((r) => r.city.id === "london-gb")!.breakEven);
  const guess = evaluate(d, { ...p, income: { ...p.income, everyday: { ...p.income.everyday!, assumed: true } } });
  assert.ok(guess.results.every((r) => r.breakEven === null));
});

test("childcare from the OECD: the latest year per case, couples on 100% and 67% of the average wage only", () => {
  const got = nccObservations(NCC_CSV, "ITA", { retrieved: "x", url: "u" });
  const v = (m: string) => got.find((x) => x.metric === m)?.value;
  assert.equal(v("childcare_net_couple_1"), 1_200);
  assert.equal(v("childcare_fees_2"), 11_838);
  assert.equal(v("childcare_net_single_1"), 600);
  assert.equal(v("childcare_net_single_2"), undefined, "an empty value is not a zero");
  assert.ok(got.every((x) => x.period === "2026" && x.level === "country"));
});

test("public holidays: weekdays only, nationwide plus the city's own region; statutory leave needs no network", async () => {
  const ctx = makeCtx({ runtime: "node", fetch: async (u) => new Response(String(u).includes("nager") ? JSON.stringify(NAGER_IT) : "", { status: 200 }), now: () => new Date("2026-06-01T00:00:00Z") });
  const palermo = { id: "palermo-it", name: "Palermo", country: "IT", region: "IT-82", lat: 38.1, lon: 13.4 };
  const [h] = await nagerHolidays.fetch(palermo, ctx);
  // 1 Jan (Thu), 6 Jan (Tue), 6 Apr (Mon), 15 Jul (Wed, Sicily), 25 Dec (Fri); Easter Sunday and an observance do not count.
  assert.equal(h!.value, 5);
  assert.equal(h!.level, "region");
  const [l] = await labourLaw.fetch(palermo, ctx);
  assert.equal(l!.value, 20);
  assert.match(l!.note!, /D\.Lgs\. 66\/2003/);
  assert.equal(oecdChildcare.covers!(palermo), true);
  const empty = makeCtx({ runtime: "node", fetch: async () => new Response("", { status: 200 }), now: () => new Date() });
  assert.deepEqual(await nagerHolidays.fetch({ ...palermo, country: "AE" }, empty), []);
});
