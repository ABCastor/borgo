import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "../src/core/criteria.ts";
import { criteriaFor, evaluate, weightOf } from "../src/core/engine.ts";
import { grouped, groupOf, GROUPS, splitGroupWeight } from "../src/core/groups.ts";
import { fixture, profile } from "./fixture.ts";

const data = fixture();

test("groups: every named part is a real line, and every line sits in exactly one group", () => {
  const ids = new Set(CRITERIA.map((c) => c.id));
  for (const g of GROUPS) for (const m of g.members) assert.ok(ids.has(m), `${g.id} names ${m}, which is not a criterion`);
  const p = profile({ personal: [{ id: "mine-1", label: "Family nearby", scores: {} }] });
  const all = criteriaFor(p);
  const placed = grouped(all).flatMap((x) => x.parts.map((c) => c.id));
  assert.deepEqual([...placed].sort(), all.map((c) => c.id).sort());
  assert.equal(groupOf(all.find((c) => c.id === "mine-1")!), "own");
  assert.equal(groupOf(CRITERIA.find((c) => c.id === "politics")!), "stand");
  assert.equal(groupOf(CRITERIA.find((c) => c.id === "nice_days")!), "climate");
  // A line no group names joins by its category.
  assert.equal(groupOf({ ...CRITERIA.find((c) => c.id === "jobs")!, id: "something_new" }), "ambition");
});

test("groups: the list stays short", () => {
  assert.ok(GROUPS.length <= 12);
  const shown = GROUPS.filter((g) => !g.shows || g.shows(profile()));
  assert.ok(!shown.some((g) => g.id === "children"), "no children, no children's group");
  assert.ok(GROUPS.find((g) => g.id === "children")!.shows!(profile({ children: [3] })));
});

test("a group's dial shares its weight over its parts in their proportions, to the hundredth", () => {
  const parts = [
    { id: "a", weight: 8, defaultWeight: 8 },
    { id: "b", weight: 4, defaultWeight: 4 },
    { id: "c", weight: 0, defaultWeight: 3 },
  ];
  assert.deepEqual(splitGroupWeight(parts, 24), { a: 16, b: 8, c: 0 });
  const odd = splitGroupWeight(parts, 10);
  assert.equal(Object.values(odd).reduce((s, x) => s + x, 0), 10);
  assert.ok(Math.abs(odd.a! / odd.b! - 2) < 0.01);
  // Every part at 0: their default weights decide; and when those are 0 too, equal parts.
  assert.deepEqual(splitGroupWeight(parts.map((p) => ({ ...p, weight: 0 })), 15), { a: 8, b: 4, c: 3 });
  assert.deepEqual(splitGroupWeight([{ id: "x", weight: 0, defaultWeight: 0 }, { id: "y", weight: 0, defaultWeight: 0 }], 9), { x: 4.5, y: 4.5 });
  assert.deepEqual(splitGroupWeight(parts, 0), { a: 0, b: 0, c: 0 });
});

test("the engine scores a group as the sum of its parts: moving a group's dial is the same as moving its parts", () => {
  const base = profile({ cities: ["turin-it", "dublin-ie", "london-gb"] });
  const health = grouped(criteriaFor(base)).find((g) => g.group.id === "health")!;
  const before = health.parts.reduce((s, c) => s + weightOf(base, c), 0);
  const split = splitGroupWeight(health.parts.map((c) => ({ id: c.id, weight: weightOf(base, c), defaultWeight: c.defaultWeight })), before * 3);
  const viaGroup = evaluate(data, { ...base, weights: { ...base.weights, ...split } });
  // The same weights, set part by part by hand: each part three times what it was.
  const byHand = Object.fromEntries(health.parts.map((c) => [c.id, weightOf(base, c) * 3]));
  const viaParts = evaluate(data, { ...base, weights: { ...base.weights, ...byHand } });
  for (const r of viaGroup.results) {
    const o = viaParts.results.find((x) => x.city.id === r.city.id)!;
    assert.ok(Math.abs(r.total - o.total) < 1e-9, `${r.city.name}: ${r.total} vs ${o.total}`);
  }
  // The group now holds three times the weight: its parts' weights add up to it exactly.
  assert.equal(Object.values(split).reduce((s, x) => s + x, 0), before * 3);
});

test("childcare and parents' leave count only for a household with children", () => {
  const childcare = CRITERIA.find((c) => c.id === "childcare")!;
  const leave = CRITERIA.find((c) => c.id === "family_leave")!;
  assert.equal(weightOf(profile(), childcare), 0);
  assert.equal(weightOf(profile({ weights: { childcare: 20 } }), childcare), 0, "a weight without children counts for nothing");
  assert.equal(weightOf(profile({ children: [2] }), childcare), childcare.defaultWeight);
  assert.equal(weightOf(profile({ children: [2] }), leave), leave.defaultWeight);
  const d = fixture();
  d.observations["turin-it"]!.push(
    { metric: "leave_mothers", value: 20, period: "2025", level: "country", source: "test", retrieved: "2026-10-27" },
    { metric: "leave_fathers", value: 5, period: "2025", level: "country", source: "test", retrieved: "2026-10-27" },
  );
  const line = evaluate(d, profile({ children: [2] })).results.find((r) => r.city.id === "turin-it")!.lines.find((l) => l.id === "family_leave")!;
  assert.equal(line.raw.value, 25);
  assert.match(line.raw.text, /25 weeks \(mother 20, father 5\)/);
});
