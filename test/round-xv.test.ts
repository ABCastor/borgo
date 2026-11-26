// Round XV, the site: a standard catalogue of priorities, nice days inside Weather, an X on every priority, wins and
// loses opened in place, gaps said plainly, and rows that slide only when their order changes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate } from "../src/core/engine.ts";
import { grouped } from "../src/core/groups.ts";
import { glanceScale, winsLosses } from "../src/ui/glance.ts";
import { partialNote } from "../src/ui/partial.ts";
import { compareView } from "../src/ui/results.ts";
import { emptyProfile, type AppState } from "../src/ui/state.ts";
import { flipRows } from "../src/ui/transitions.ts";
import { share, START_WITH, valuesSheet } from "../src/ui/values.ts";
import { fixture, profile } from "./fixture.ts";

const data = fixture();
const zero = Object.fromEntries(CRITERIA.map((c) => [c.id, 0]));
const app = (p = emptyProfile(data), o: Partial<AppState> = {}): AppState => ({ data, profile: p, view: "cities", city: null, measure: "air", valuesOpen: true, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [], ...o });
/** The markup of one priority row. */
const row = (ui: string, id: string) => {
  const at = ui.indexOf(`data-group="${id}"`);
  assert.ok(at > 0, `row ${id}`);
  const end = ui.indexOf('<li class="vgroup', at);
  return ui.slice(at, end < 0 ? ui.indexOf('class="priority-catalogue"', at) : end);
};

test("nice days is a line inside Weather, with its definition in place, never a heading of its own", () => {
  const p = profile({ weights: { ...zero, nice_days: 10, sunshine: 5, money_left: 20 } });
  const ui = valuesSheet(app(p)).value;
  assert.doesNotMatch(ui, /nice-headline|<h3[^>]*>Nice days<\/h3>/);
  const weather = row(ui, "climate");
  assert.match(weather, /<ul class="vg-on" aria-label="What counts in Weather">/);
  assert.match(weather, /<li class="vg-line is-nice"><span class="vg-ln">Nice days<\/span>/);
  assert.match(weather, /data-act="comfort" data-where="values"/, "the range is edited on the line");
  assert.match(weather, /Edit weather tests: Dry, sunny/);
  assert.match(weather, /Sunshine/);
  // Opened, nice days is a dial of Weather with its definition under it, and Weather's other standard lines are one click each.
  const open = row(valuesSheet(app(p, { openGroups: ["climate"] })).value, "climate");
  assert.match(open, /<label class="val-n" for="w-nice_days"[^>]*>Nice days<\/label>[\s\S]*class="vg-def"/);
  assert.match(open, /More weather lines/);
  assert.match(open, /data-act="line" data-id="dry_days" aria-pressed="false"/);
  assert.doesNotMatch(open, /data-act="line" data-id="nice_days" aria-pressed/, "a line that counts is not offered again");
});

test("every priority row has a named X, a 44px button that removes it; a line that counts has its own X when opened", () => {
  const p = profile({ weights: { ...zero, nice_days: 10, money_left: 20, safety: 6, happiness: 4 } });
  const ui = valuesSheet(app(p)).value;
  for (const [id, label] of [["money", "Money"], ["climate", "Weather"], ["safety", "Safety"], ["people", "People and society"]]) {
    assert.match(row(ui, id!), new RegExp(`<button class="prio-x" data-act="remove-priority" data-id="${id}" aria-label="Remove ${label}"`));
  }
  assert.doesNotMatch(ui, /data-act="remove-priority"[^>]*>Remove</, "no text link besides the X");
  const open = row(valuesSheet(app(p, { openGroups: ["people"] })).value, "people");
  assert.match(open, /data-act="line" data-id="happiness" aria-label="Remove Happiness"/);
  // Undo names what went.
  assert.match(valuesSheet(app(p, { removedPriority: "climate" })).value, /Weather removed\. <button class="link" data-act="undo-priority" data-id="climate">Undo<\/button>/);
  assert.match(valuesSheet(app(p, { removedLine: { id: "happiness", label: "Happiness", weight: 4 } })).value, /Happiness removed\. <button class="link" data-act="undo-line"/);
});

test("Add priority is the standard catalogue: the usual starting lines first, then every group with its lines, your own lines last", () => {
  const p = profile({ weights: { ...zero, nice_days: 10 } });
  const ui = valuesSheet(app(p, { catalogueOpen: true })).value;
  const cat = ui.slice(ui.indexOf('id="priority-options"'), ui.indexOf('<section class="requirements"'));
  assert.doesNotMatch(cat, /id="priority-options" class="catalogue" hidden/, "open while ticking lines");
  const start = cat.slice(cat.indexOf("Most people start with"), cat.indexOf('<ul class="cat-list"'));
  for (const id of START_WITH) assert.match(start, new RegExp(`data-act="line" data-id="${id}"`));
  assert.match(start, /data-id="nice_days" aria-pressed="true"/, "what already counts is ticked");
  const visible = grouped(CRITERIA).filter(({ group }) => !group.shows || group.shows(p)).map(({ group }) => group.label);
  const shown = [...cat.matchAll(/<h3 class="cat-h">([^<]+)<\/h3>/g)].map((m) => m[1]).filter((x) => x !== "Most people start with");
  assert.deepEqual(shown, visible);
  assert.equal(shown.at(-1), "Your own lines");
  assert.match(cat, /<h3 class="cat-h">Weather<\/h3><span class="cat-on">Counts<\/span>/);
  assert.match(cat, /<button id="wg-health" class="pill-btn" data-act="add-priority" data-id="health" aria-label="Add Health">Add<\/button>/);
  for (const line of ["Long lives", "Clean air", "Doctors"]) assert.match(cat, new RegExp(`\\+</span> ${line}</button>`));
  // A search keeps only the groups that name it.
  const searched = valuesSheet(app(p, { catalogueOpen: true, catalogueQuery: "doctor" })).value;
  assert.match(searched, /data-catalogue-label="health[^"]*doctors[^"]*" >/);
  assert.match(searched, /data-catalogue-label="weather[^"]*" hidden>/);
});

test("the person's own lines say Yours and have an X, standard lines do not say Yours", () => {
  const p = profile({ weights: { ...zero, fam: 10 }, personal: [{ id: "fam", label: "Family nearby", scores: {} }] });
  const open = valuesSheet(app(p, { openGroups: ["own"] })).value;
  assert.match(open, /Family nearby<span class="yours">Yours<\/span>/);
  assert.match(open, /data-act="remove-line" data-id="fam" aria-label="Remove Family nearby"/);
  assert.match(valuesSheet(app(p)).value, /<span class="vg-ln">Family nearby<span class="yours">Yours<\/span>/);
  // At 0, an own line still has its dial in the open group: it has no chip to come back from.
  const off = profile({ weights: { ...zero, fam: 0, gut: 5 }, personal: [{ id: "fam", label: "Family nearby", scores: {} }, { id: "gut", label: "Gut", scores: {} }] });
  assert.match(valuesSheet(app(off, { openGroups: ["own"] })).value, /for="w-fam"[^>]*>Family nearby/);
});

test("wins and loses: the two biggest each way, then every line once opened, and a gap is left out, not zero", () => {
  const p = profile({ weights: { ...zero, money_left: 20, clean_air: 8, nice_days: 8, safety: 6 } });
  const e = evaluate(data, p);
  const r = e.results.find((x) => x.city.id === "dublin-ie")!;
  const closed = winsLosses(r, e, glanceScale(e), []).value;
  assert.match(closed, /data-act="wl" data-key="card:dublin-ie" aria-expanded="false" aria-controls="wl-card-dublin-ie-dublin-ie">See all \d+ lines/);
  assert.doesNotMatch(closed, /class="wl-gap"/);
  const open = winsLosses(r, e, glanceScale(e), [], { open: true }).value;
  assert.match(open, /aria-expanded="true"[^>]*>Show fewer/);
  // The fixture has no nice-day or homicide figures: weighted, they are named as left out of the score, never counted as zero.
  assert.match(open, /<p class="wl-gap">No figure here for [^<]*nice days[^<]*: left out of its score, not counted as zero\.<\/p>/);
  // Open, every scored line is in a list or named as level with the others.
  for (const l of r.lines.filter((l) => l.weight > 0 && l.score !== null)) assert.ok(open.includes(`${l.label}:`) || /Level with the others/.test(open), l.id);
});

test("Compare has the same wins and loses per city, opening together, and marks a weighted gap on its cell", () => {
  const p = profile({ weights: { ...zero, money_left: 20, clean_air: 8, nice_days: 8 } });
  const s = app(p, { view: "compare", wlOpen: ["cmp"] });
  const ui = compareView(s, evaluate(data, p)).value;
  assert.match(ui, /<tr class="cmp-wl"><th scope="row">Wins and loses/);
  assert.equal((ui.match(/data-act="wl" data-key="cmp" aria-expanded="true"/g) ?? []).length, p.cities.length);
  assert.match(ui, /<small class="gap-note">Left out of the score, not counted as zero<\/small>/);
});

test("the partial-data note says gaps are left out, not zero, in fixed scoring only", () => {
  const p = profile({ weights: { ...zero, clean_air: 8, nice_days: 8 } });
  const e = evaluate(data, p);
  const r = e.results.find((x) => x.city.id === "dublin-ie")!;
  const fixed = partialNote(app(p), r).value;
  assert.match(fixed, /Partial data[\s\S]*Gaps are left out of its score, not counted as zero\./);
  const rel = profile({ weights: p.weights, prefs: { ...p.prefs, normalise: "relative" } });
  assert.doesNotMatch(partialNote(app(rel), evaluate(data, rel).results.find((x) => x.city.id === "dublin-ie")!).value, /not counted as zero/);
});

test("rows slide only when their place in the order changes, and never with reduced motion", () => {
  const animated: string[] = [];
  const list = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  let order = ["a", "b", "c"];
  let heights: Record<string, number> = { a: 40, b: 40, c: 40 };
  const rows = () => {
    let y = 0;
    return order.map((k) => {
      const top = y;
      y += heights[k]!;
      return { dataset: { flipRow: k }, parentElement: list, getBoundingClientRect: () => ({ left: 0, top }), animate: () => animated.push(k) };
    });
  };
  const root = { querySelectorAll: () => rows() } as unknown as ParentNode;
  flipRows(() => (order = ["b", "a", "c"]), root, false);
  assert.deepEqual(animated.sort(), ["a", "b"], "the two that swapped slide; the third stays");
  animated.length = 0;
  flipRows(() => (heights = { a: 200, b: 40, c: 40 }), root, false);
  assert.deepEqual(animated, [], "a row opening above pushes the rest at once");
  flipRows(() => (order = ["b", "c"]), root, false);
  assert.deepEqual(animated.sort(), ["c"], "removing a row slides those that move up");
  animated.length = 0;
  flipRows(() => (order = ["c", "b"]), root, true);
  assert.deepEqual(animated, [], "reduced motion: no slide");
});

test("a line that counts never reads 0%: under half a percent is said as under 1%", () => {
  assert.equal(share(0.3, 100), "<1%");
  assert.equal(share(0, 100), "0%");
  assert.equal(share(50, 100), "50%");
  assert.equal(share(1, 0), "0%");
});
