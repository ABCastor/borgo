// A first visit: Borgo says what it is and asks first for what moves the ranking most; a place being added
// shows its sheet at once; the header carries the name beside the mark. Checked on the published dataset, no browser.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { evaluate } from "../src/core/engine.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { ROOT } from "../pipeline/lib.ts";
import { productHeader } from "../scripts/site.ts";
import { citiesView } from "../src/ui/cards.ts";
import { defaultProfile, type AppState } from "../src/ui/state.ts";
import { topQuestion, verdict } from "../src/ui/top.ts";

const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const app = (profile: Profile, over: Partial<AppState> = {}): AppState => ({ data, profile, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [], ...over });
const text = (h: { value: string }) => h.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("a newcomer sees a five-step skippable walkthrough, and can reopen it", () => {
  const p = defaultProfile(data);
  const e = evaluate(data, p);
  const top = text(topQuestion(app(p, { intro: true }), e));
  assert.match(top, /The best place to live, for you/);
  assert.match(top, /Borgo is yours. It ranks cities on what you value/);
  assert.match(top, /Every number shows its source/);
  for (const name of ["Cities", "Priorities", "Money", "People", "Weather"]) assert.ok(top.includes(name));
  assert.match(top, /Skip walkthrough/);
  assert.match(top, /Guided setup/);
  assert.match(top, /Reset/);
  const salaryStep = topQuestion(app(p, { intro: true, onboardingStep: 2 }), e).value;
  assert.match(salaryStep, /id="setup-salary"/);
  assert.doesNotMatch(text(topQuestion(app(p), e)), /The best place to live/);
});

test("a place being added has its sheet on the wall at once, named, with each source's progress, and a chip in the roster", () => {
  const p = defaultProfile(data);
  const e = evaluate(data, p);
  const live: AppState["live"] = { query: "Palermo", label: "Palermo, Sicily, Italy", name: "Palermo", cityId: "palermo-it", sources: [{ source: "open-meteo-era5", status: "running" }, { source: "worldbank", status: "waiting" }] };
  const s = app(p, { live });
  const wall = citiesView(s, e).value;
  assert.match(wall, /class="sheet dos is-loading [^"]*" data-flip="palermo-it"/, "drawn under the id its filled sheet will have");
  assert.ok(wall.indexOf("is-loading") < wall.indexOf(`data-flip="${e.results[0]!.city.id}"`), "first on the wall, where it is seen");
  assert.match(text({ value: wall }), /Palermo Adding · Sicily, Italy/);
  assert.match(text({ value: wall }), /fetching…/);
  assert.match(text(topQuestion(s, e)), /Palermo , being added/);
  // A failure says why and can be dismissed, on the sheet itself.
  const failed = citiesView(app(p, { live: { ...live, error: "None of the sources answered." } }), e).value;
  assert.match(text({ value: failed }), /Not added .*Could not add Palermo, Sicily, Italy\. None of the sources answered\. Dismiss/);
  // With no cities yet, the sheet is still shown instead of the empty state.
  const none = { ...p, cities: [] };
  assert.match(citiesView(app(none, { live }), evaluate(data, none)).value, /is-loading/);
});

test("the header: the mark, the name right beside it, then the sections, then the gear", () => {
  const h = productHeader("#/", [{ href: "#/", label: "Cities", current: true }], { settings: true });
  const at = (s: string) => h.indexOf(s);
  assert.ok(at('class="bmark"') < at('class="bname"') && at('class="bname"') < at('class="nav"') && at('class="nav"') < at("settings-toggle"));
});
