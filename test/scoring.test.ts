// Missing data never helps a city, must-pass lines are pass / fail / unknown, and group dials never wake an unset line.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "../src/core/criteria.ts";
import { criteriaFor, evaluate, weightOf } from "../src/core/engine.ts";
import { grouped, splitGroupWeight } from "../src/core/groups.ts";
import { PRESETS } from "../src/core/presets.ts";
import { rightToLiveWork } from "../src/core/rights.ts";
import type { Profile } from "../src/core/types.ts";
import { fixture, profile } from "./fixture.ts";

const data = fixture();
const zero = Object.fromEntries(CRITERIA.map((c) => [c.id, 0]));
const missing = (m: Profile["prefs"]["missing"]): Profile["prefs"] => ({ comfort: { min: 12, max: 24 }, normalise: "absolute", missing: m });
const line = (r: { lines: { id: string }[] }, id: string) => r.lines.find((l) => l.id === id) as ReturnType<typeof evaluate>["results"][number]["lines"][number];

// Personal lines score (v - 1) / 4, so 3.4 is 0.6, 1.8 is 0.2, 3 is 0.5.
function twoLines(cities: string[], scores: Record<string, [number, number | undefined]>, m: Profile["prefs"]["missing"] = "lowest") {
  const one = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v[0]]));
  const two = Object.fromEntries(Object.entries(scores).filter(([, v]) => v[1] !== undefined).map(([k, v]) => [k, v[1]!]));
  return evaluate(
    data,
    profile({
      cities,
      weights: { ...zero, you_one: 70, you_two: 30 },
      personal: [
        { id: "you_one", label: "One", scores: one },
        { id: "you_two", label: "Two", scores: two },
      ],
      prefs: missing(m),
    }),
  );
}

test("adding a last-placed city cannot reverse the winner through a gap (the imputation counterexample)", () => {
  const A = "turin-it", B = "dublin-ie", C = "london-gb";
  const scores: Record<string, [number, number | undefined]> = { [A]: [3.4, 1.8], [B]: [3, undefined], [C]: [1, 5] };
  const before = twoLines([A, B], scores);
  const after = twoLines([A, B, C], scores);
  assert.equal(before.results[0]!.city.id, A);
  assert.equal(after.results[0]!.city.id, A, "B must not overtake A because a city with a high score joined");
  const b = after.results.find((r) => r.city.id === B)!;
  assert.ok(Math.abs(b.total - 41) < 1e-9, `B stays at 41, got ${b.total}`);
  // A saved profile still saying "average" is read the same way.
  assert.equal(twoLines([A, B, C], scores, "average").results[0]!.city.id, A);
});

test("a gap never scores above any city that has a figure on that line", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ids = data.cities.map((c) => c.id);
  for (let n = 0; n < 200; n++) {
    const scores: Record<string, [number, number | undefined]> = {};
    for (const id of ids) scores[id] = [1 + rnd() * 4, rnd() < 0.4 ? undefined : 1 + rnd() * 4];
    for (const m of ["lowest", "worst", "average"] as const) {
      const e = twoLines(ids, scores, m);
      const seen = e.results.map((r) => line(r, "you_two")).filter((l) => l.observed).map((l) => l.score!);
      for (const r of e.results) {
        const l = line(r, "you_two");
        if (l.imputed && seen.length) assert.ok(l.score! <= Math.min(...seen) + 1e-12, `${m}: gap ${l.score} above observed ${Math.min(...seen)}`);
      }
    }
  }
});

// San Francisco's compulsory health premium is given, so its money is whole and only the case under test is missing.
const premium = { "san-francisco-us": { health_premium: 400 } };

test("money is compared on one basis for every city: take-home pay when a rent is missing, and says which rent to add", () => {
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => o.metric !== "rent_1bed");
  const e = evaluate(d, profile({ weights: { ...zero, money_left: 20 }, overrides: premium }));
  for (const r of e.results) {
    const l = line(r, "money_left");
    assert.equal(l.basis, "take-home pay less any compulsory health premium (rent and spending not counted)");
    assert.equal(l.imputed, false);
    assert.match(l.raw.text, /take-home a month/);
  }
  // San Francisco's take-home is compared after its $400 premium (display EUR at 1.1 USD), like pay elsewhere after health contributions.
  const sf = e.results.find((r) => r.city.id === "san-francisco-us")!;
  assert.ok(Math.abs(line(sf, "money_left").raw.value! - (sf.money.display.net! / 12 - 400 / 1.1)) < 1e-9);
  assert.match(e.notes.join(" "), /Money left each month is scored on take-home pay .* because Dublin has no figure: add your rent for Dublin\./);
  // With the same salary everywhere, take-home differs only by tax: a real rent cannot sink one city below another that lacks it.
  const full = evaluate(fixture(), profile({ weights: { ...zero, money_left: 20 }, overrides: premium }));
  assert.ok(full.results.every((r) => line(r, "money_left").basis === null), "with every rent known, money left is itself");
});

test("money with no salary anywhere is scored on cost alone; with neither, it counts for no city", () => {
  const noPay = profile({ weights: { ...zero, money_left: 20 }, overrides: premium, income: { ...profile().income, gross: 0 } });
  const e = evaluate(data, noPay);
  assert.ok(e.results.every((r) => line(r, "money_left").basis === "cost a month (pay not counted)"));
  assert.match(e.notes.join(" "), /because no city has a figure: add a salary/);
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => o.metric !== "rent_1bed");
  const out = evaluate(d, noPay);
  assert.ok(out.results.every((r) => line(r, "money_left").score === null && r.total === 0));
  assert.match(out.notes.join(" "), /left out of the score for every city/);
});

test("the real snapshot: no seed city gains on money from a missing rent", async () => {
  const { loadDataset } = await import("../src/agent/dataset.ts");
  const ds = loadDataset();
  const p = profile({ cities: ds.cities.map((c) => c.id), household: [], income: { ...profile().income, gross: 100_000 } });
  const e = evaluate(ds, p);
  const ml = e.results.map((r) => line(r, "money_left"));
  assert.ok(ml.every((l) => !l.imputed), "money is never imputed");
  const bases = new Set(ml.map((l) => l.basis));
  assert.equal(bases.size, 1, "one basis for every city");
});

test("must pass: a city with no figure is unknown, shown, and ranked after every city that passes", () => {
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => o.metric !== "rent_1bed");
  const e = evaluate(d, profile({ dealBreakers: ["money_left"] }));
  const dub = e.results.find((r) => r.city.id === "dublin-ie")!;
  assert.equal(line(dub, "money_left").check, "unknown");
  assert.deepEqual(dub.unresolved, ["Money left each month"]);
  assert.deepEqual(dub.ruledOut, []);
  const passing = e.results.filter((r) => !r.ruledOut.length && !r.unresolved.length);
  assert.ok(passing.every((r) => r.rank < dub.rank), "an unknown never ranks above a city that passes");
});

test("unknown passports are not checked: no 'needs a visa', the must-pass is unknown, and the line counts for nobody", () => {
  const r = rightToLiveWork(data, { label: "Person 2", citizenships: [] }, "GB");
  assert.equal(r.status, "unknown");
  assert.equal(r.allowed, false);
  assert.match(r.text, /Not checked: add Person 2's passports/);
  const e = evaluate(data, profile({ household: [{ label: "You", citizenships: [] }, { label: "Person 2", citizenships: [] }], dealBreakers: ["right_to_live"] }));
  for (const c of e.results) {
    const l = line(c, "right_to_live");
    assert.equal(l.raw.value, null);
    assert.equal(l.check, "unknown");
    assert.equal(l.score, null, "no city has a figure, so the line counts for none");
    assert.deepEqual(c.ruledOut, []);
  }
  // One person known and unable to move there: the line fails whatever the other's passports are.
  const mixed = evaluate(data, profile({ household: [{ label: "You", citizenships: ["IT"] }, { label: "Person 2", citizenships: [] }], dealBreakers: ["right_to_live"] }));
  assert.equal(line(mixed.results.find((x) => x.city.id === "london-gb")!, "right_to_live").check, "fail");
  assert.equal(line(mixed.results.find((x) => x.city.id === "dublin-ie")!, "right_to_live").check, "unknown");
});

test("a 'no' on the right to live is actionable and cites the rules checked", () => {
  const r = rightToLiveWork(data, { label: "You", citizenships: ["US"] }, "IE");
  assert.equal(r.status, "no");
  assert.match(r.text, /No automatic right to live and work in Ireland/);
  assert.match(r.text, /residence and work permit/);
  assert.ok(r.sources.length >= 1);
});

test("position lines without a stance take no weight, and a group dial never gives them any", () => {
  const p = profile({ weights: { politics: 10, abortion: 10 }, stances: { politics: 4 } });
  const by = (id: string) => CRITERIA.find((c) => c.id === id)!;
  assert.equal(weightOf(p, by("politics")), 10);
  assert.equal(weightOf(p, by("abortion")), 0, "no stance, no weight");
  const stand = grouped(criteriaFor(p)).find((g) => g.group.id === "stand")!.parts;
  const fresh = profile({ stances: { politics: 4 } });
  const split = splitGroupWeight(stand.map((c) => ({ id: c.id, weight: weightOf(fresh, c), defaultWeight: c.defaultWeight, applies: !c.applies || c.applies(fresh) })), 12);
  assert.deepEqual(split, { politics: 12, abortion: 0, couples_law: 0 });
  const none = splitGroupWeight(stand.map((c) => ({ id: c.id, weight: 0, defaultWeight: 0, applies: !c.applies || c.applies(profile()) })), 12);
  assert.deepEqual(none, { politics: 0, abortion: 0, couples_law: 0 });
});

test("a group's parts add up to the dial exactly, even split twelve ways", () => {
  const parts = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, weight: 1, defaultWeight: 1 }));
  for (const t of [0.1, 0.05, 1, 7.77, 99.99]) {
    const s = splitGroupWeight(parts, t);
    assert.equal(Math.round(Object.values(s).reduce((a, b) => a + b, 0) * 100), Math.round(t * 100), `total ${t}`);
    assert.ok(Object.values(s).every((x) => x >= 0));
  }
});

test("childcare counts only with a child under 6; cost of living does not count twice by default", () => {
  const cc = CRITERIA.find((c) => c.id === "childcare")!;
  assert.equal(weightOf(profile({ children: [7] }), cc), 0);
  assert.equal(weightOf(profile({ children: [7, 4] }), cc), cc.defaultWeight);
  const lc = CRITERIA.find((c) => c.id === "living_cost")!;
  assert.equal(lc.defaultWeight, 0);
  for (const p of PRESETS) assert.ok(!p.weights.living_cost, `${p.id} leaves cost of living at 0`);
});
