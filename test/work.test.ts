// Work and ambition by kind of work, and the generic quality-of-life index: the recipes, the weight they share, the
// default left as it was, San Francisco's lead for software and founders on the real figures, and the index's rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDataset } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { cityReport, compare } from "../src/agent/report.ts";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate } from "../src/core/engine.ts";
import { chooseWork, groupOf } from "../src/core/groups.ts";
import { QOL_INDICES } from "../src/core/links.ts";
import { QOL_MIN_COVERAGE, QOL_PARTS, qualityOfLife } from "../src/core/qol.ts";
import type { Profile } from "../src/core/types.ts";
import { ambitionScores, workWhy } from "../src/core/work-why.ts";
import { AMBITION_MEMBERS, WORK_KINDS, WORK_METRICS } from "../src/core/work.ts";

const real = loadDataset();
const ambition = CRITERIA.filter((c) => groupOf(c) === "ambition");
const groupTotal = (w: Record<string, number>) => ambition.reduce((t, c) => t + (w[c.id] ?? c.defaultWeight), 0);
const BIG = ["san-francisco-us", "new-york-us", "boston-us", "seattle-us", "london-gb", "cambridge-gb", "berlin-de", "paris-fr", "zurich-ch", "amsterdam-nl", "lisbon-pt", "turin-it", "toronto-ca", "tokyo-jp", "singapore-sg"];

test("work: every kind's recipe sums to 1 over real parts of Work and ambition", () => {
  assert.equal(WORK_KINDS.length, 17);
  const ids = new Set(ambition.map((c) => c.id));
  for (const k of WORK_KINDS) {
    const sum = Object.values(k.recipe).reduce((t, x) => t + x, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${k.id} sums to ${sum}`);
    for (const id of Object.keys(k.recipe)) assert.ok(ids.has(id) && AMBITION_MEMBERS.includes(id), `${k.id}: ${id} is a part of the group`);
    // Pay in the field is only in the recipe of a kind with a pay figure; jobs in the field only with a sector.
    if (!k.pay) assert.equal(k.recipe.field_pay, undefined, k.id);
    if (!k.sector) assert.equal(k.recipe.field_jobs, undefined, k.id);
    if (k.pay) assert.ok(WORK_METRICS[`pay_${k.id}`], `pay_${k.id} is a metric`);
  }
  assert.ok(WORK_KINDS.some((k) => k.id === "founder" && !k.pay));
});

test("work: choosing a kind keeps the group's weight and shares it by the recipe; clearing it shares it by default again", () => {
  const { profile } = buildProfile(real, { cities: ["turin-it"] });
  const before = groupTotal(profile.weights);
  assert.ok(before > 0, "Work and ambition counts by default");
  for (const k of WORK_KINDS) {
    const p = chooseWork(profile, k.id, CRITERIA);
    assert.equal(p.work, k.id);
    assert.ok(Math.abs(groupTotal(p.weights) - before) < 0.1, `${k.id} keeps the total`);
    for (const c of ambition) assert.ok(Math.abs((p.weights[c.id] ?? 0) - before * (k.recipe[c.id] ?? 0)) < 0.01, `${k.id}: ${c.id}`);
    // Lines outside the group do not move.
    for (const c of CRITERIA.filter((x) => groupOf(x) !== "ambition")) assert.equal(p.weights[c.id], profile.weights[c.id], `${k.id} leaves ${c.id}`);
    const back = chooseWork(p, undefined, CRITERIA);
    assert.equal(back.work, undefined);
    for (const c of ambition) assert.ok(Math.abs((back.weights[c.id] ?? c.defaultWeight) - (profile.weights[c.id] ?? c.defaultWeight)) < 0.01, `clearing restores ${c.id}`);
  }
  // A group with no weight yet starts where it is told to (the app's third priority).
  const off = { ...profile, weights: { ...profile.weights, ...Object.fromEntries(ambition.map((c) => [c.id, 0])) } } as Profile;
  assert.ok(Math.abs(groupTotal(chooseWork(off, "software", CRITERIA, 12).weights) - 12) < 0.01);
});

test("work: with no kind, nothing new counts and nobody's score moves", () => {
  for (const id of ["field_pay", "field_jobs", "young_companies", "qol"]) assert.equal(CRITERIA.find((c) => c.id === id)!.defaultWeight, 0, id);
  const { profile } = buildProfile(real, { cities: BIG });
  assert.equal(profile.work, undefined);
  for (const id of ["field_pay", "field_jobs", "young_companies", "qol"]) assert.ok(!(profile.weights[id]! > 0), `${id} has no weight`);
  const e = evaluate(real, profile);
  for (const r of e.results) for (const l of r.lines.filter((x) => ["field_pay", "field_jobs", "young_companies", "qol"].includes(x.id))) assert.equal(l.weight, 0, `${r.city.id} ${l.id}`);
  // No kind, no work sentences.
  assert.equal(workWhy(real, profile, e, "san-francisco-us"), null);
  assert.equal(compare(real, { cities: BIG }).cities.some((c) => c.work), false);
});

test("work: San Francisco leads Work and ambition for software and for founders, and says why", () => {
  const leader = (work?: string) => {
    const { profile } = buildProfile(real, { cities: BIG, ...(work ? { work } : {}) });
    const e = evaluate(real, profile);
    const s = [...ambitionScores(e).entries()].sort((a, b) => b[1] - a[1]);
    return { profile, e, top: s[0]![0], sf: s.findIndex(([id]) => id === "san-francisco-us") + 1 };
  };
  // Without a kind, research output alone puts university towns first: the gap this work closes.
  assert.notEqual(leader().top, "san-francisco-us");
  for (const work of ["software", "founder"]) {
    const { profile, e, top } = leader(work);
    assert.equal(top, "san-francisco-us", `${work}: San Francisco first`);
    const w = workWhy(real, profile, e, "san-francisco-us")!;
    assert.match(w.lead, /San Francisco scores \d+ of 100 on Work and ambition, first of your 15 cities/);
    assert.ok(w.parts.length >= 3, `${work}: one sentence per part`);
  }
  const sw = compare(real, { cities: ["san-francisco-us", "turin-it"], work: "software" });
  const sf = sw.cities.find((c) => c.id === "san-francisco-us")!;
  assert.match(sf.work!.parts.join(" "), /Pay in your field: .*US\$/);
  assert.match(sw.assumptions.join(" "), /Work and ambition is weighed for software and IT: /);
  // A city where English is not widely spoken says so.
  assert.match(sw.cities.find((c) => c.id === "turin-it")!.work!.parts.join(" "), /speak English/);
});

test("work: an unknown kind of work is an error that lists the kinds; case does not matter", () => {
  assert.throws(() => buildProfile(real, { cities: ["turin-it"], work: "astronaut" }), /Unknown kind of work "astronaut". Kinds: software, /);
  assert.equal(buildProfile(real, { cities: ["turin-it"], work: "Software" }).profile.work, "software");
});

test("qol: fixed weights sum to 100, parts are real lines, and other indices are links only", () => {
  assert.equal(QOL_PARTS.reduce((t, p) => t + p.weight, 0), 100);
  for (const p of QOL_PARTS.filter((x) => x.id !== "pay_prices")) assert.ok(CRITERIA.some((c) => c.id === p.id), p.id);
  assert.ok(QOL_INDICES.length >= 4 && QOL_INDICES.every((l) => /^https:\/\//.test(l.url)));
  for (const name of ["Numbeo", "Mercer", "EIU", "Monocle"]) assert.ok(QOL_INDICES.some((l) => l.label.includes(name)), name);
});

test("qol: a part with no figure is left out and the rest share its weight; under 60% there is no index", () => {
  const zurich = real.cities.find((c) => c.id === "zurich-ch")!;
  const q = qualityOfLife(real, zurich);
  assert.ok(q.score !== null && q.score > 0 && q.score <= 100);
  const have = q.parts.filter((p) => p.score !== null);
  const w = have.reduce((t, p) => t + p.weight, 0);
  assert.ok(Math.abs(q.coverage - w / 100) < 1e-9);
  assert.ok(Math.abs(q.score! - (100 * have.reduce((t, p) => t + p.weight * p.score!, 0)) / w) < 1e-9);
  // Take every figure away but one part's: no index.
  const bare: typeof real = { ...real, observations: { ...real.observations, [zurich.id]: [] } };
  const none = qualityOfLife(bare, zurich);
  assert.ok(none.coverage < QOL_MIN_COVERAGE);
  assert.equal(none.score, null);
  // The same index for everyone: the person's numbers never enter it.
  const r1 = cityReport(real, "Zurich");
  const r2 = cityReport(real, "Zurich", { passports: [["US"]] });
  assert.deepEqual(r1.qualityOfLife, r2.qualityOfLife);
  assert.equal(r1.qualityOfLife!.score, Math.round(q.score!));
  // A question about a few metrics leaves it out.
  assert.equal(cityReport(real, "Zurich", { metrics: ["pm25"] }).qualityOfLife, undefined);
});

test("qol: off by default as a line of the score, and counted only when weighted", () => {
  const off = compare(real, { cities: ["zurich-ch", "lisbon-pt"] });
  assert.equal(off.cities[0]!.lines.find((l) => l.id === "qol")?.weight ?? 0, 0);
  const on = compare(real, { cities: ["zurich-ch", "lisbon-pt"], only: ["qol"] });
  assert.equal(on.ranking[0]!.id, "zurich-ch");
});
