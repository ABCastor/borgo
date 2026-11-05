// The app's first minute and its honesty signals, checked on the published dataset without a browser: no salary is
// assumed, a share link leaves the private parts out unless asked, a passport not given is "not checked" (never "needs a
// visa"), a qualified name is never mistaken for the seed city of the same name, and the answer names its next input.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { evaluate } from "../src/core/engine.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { loadPublishedDataset } from "../src/registry/load.ts";
import { ROOT } from "../pipeline/lib.ts";
import { knownCity } from "../src/ui/place-search.ts";
import { defaultProfile, fetchedNames, linkPlaceName, sharedProfile, sharePartsHeld, shareUrl, START_WEIGHTS, type AppState } from "../src/ui/state.ts";
import { awayOf, verdict } from "../src/ui/top.ts";
import { citiesView } from "../src/ui/cards.ts";
import { ownShare } from "../src/ui/partial.ts";

const data = loadPublishedDataset(join(ROOT, "public/data/dataset.json")) as Dataset;
const app = (profile: Profile): AppState => ({ data, profile, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [] });
const text = (h: { value: string }) => h.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("first visit: no salary is assumed, only money left and nice days count, and a gap scores as the lowest", () => {
  const p = defaultProfile(data);
  assert.equal(p.income.gross, 0);
  assert.equal(p.prefs.missing, "lowest");
  const counting = Object.entries(START_WEIGHTS).filter(([, w]) => w > 0).map(([id]) => id).sort();
  assert.deepEqual(counting, ["money_left", "nice_days"]);
  const e = evaluate(data, p);
  assert.ok(e.results.every((r) => r.money.missing.includes("salary")), "money waits for a salary everywhere");
  const v = text(verdict(app(p), e));
  assert.match(v, /add your salary/, "the answer asks for the salary as its next input");
  assert.doesNotMatch(v, /leaves you the most/, "no money claim without a salary");
});

test("share link: salary, passports, household, own numbers, lines and stances stay out unless included", () => {
  const p = defaultProfile(data);
  p.income.gross = 123_456;
  p.income.pension = 0.05;
  p.household = [{ label: "You", citizenships: ["IT"], newcomer: { age: 34 } }, { label: "Anna", citizenships: ["US"], relation: "partner", pay: { gross: 50_000, currency: "EUR" } }];
  p.children = [2];
  p.overrides = { "lisbon-pt": { rent_1bed: 1_100 } };
  p.personal = [{ id: "mine-1", label: "Family nearby", scores: { "lisbon-pt": 5 } }];
  p.weights = { ...p.weights, "mine-1": 10, politics: 5 };
  p.stances = { politics: 3 };
  assert.deepEqual(sharePartsHeld(p), ["money", "household", "numbers", "lines", "stances"]);
  const plain = sharedProfile(p, []);
  assert.deepEqual(Object.keys(plain).sort(), ["cities", "dealBreakers", "displayCurrency", "housing", "prefs", "weights"]);
  const json = JSON.stringify(plain);
  for (const secret of ["123456", '"IT"', "Anna", "1100", "Family nearby", "mine-1", '"politics"', "newcomer", "pension"]) assert.ok(!json.includes(secret), `${secret} stays out`);
  const all = sharedProfile(p, ["money", "household", "numbers", "lines", "stances"]);
  assert.equal(all.income?.gross, 123_456);
  assert.equal(all.household?.[1]?.pay?.gross, 50_000);
  assert.deepEqual(all.stances, { politics: 3 });
  // The household without the money: people and passports travel, their pay does not.
  const people = sharedProfile(p, ["household"]);
  assert.equal(people.household?.[1]?.citizenships[0], "US");
  assert.equal(people.household?.[1]?.pay, undefined);
  assert.equal(people.income, undefined);
});

test("eligibility: a passport not given is 'not checked', never 'needs a visa'; a given one says yes or needs a visa or permit", () => {
  const p = { ...defaultProfile(data), cities: ["lisbon-pt", "dubai-ae"] };
  const none = text(citiesView(app(p), evaluate(data, p)));
  assert.match(none, /not checked/);
  assert.doesNotMatch(none, /needs a visa/);
  const it = { ...p, household: [{ label: "You", citizenships: ["IT"] }] };
  const known = text(citiesView(app(it), evaluate(data, it)));
  assert.match(known, /yes ?, EU and EEA/);
  assert.match(known, /You need a visa or permit/, "the person is You: need, not needs");
});

test("a must-pass that cannot be checked is said on the sheet and in the answer, and the city ranks after those that pass", () => {
  const p = { ...defaultProfile(data), cities: ["lisbon-pt", "berlin-de"], household: [{ label: "You", citizenships: ["IT"] }, { label: "Sam", citizenships: [] }], dealBreakers: ["right_to_live"] };
  const e = evaluate(data, p);
  assert.ok(e.results.every((r) => r.unresolved.length === 1));
  assert.match(text(verdict(app(p), e)), /Not known yet for Lisbon and Berlin|Not known yet for Berlin and Lisbon/);
  assert.match(text(citiesView(app(p), e)), /Not known yet:/);
});

test("a name with a qualifier matches the seed city only in that city's country (Gemini M5)", () => {
  const name = (iso: string) => ({ GB: "United Kingdom", US: "United States", CA: "Canada", IE: "Ireland" })[iso] ?? iso;
  assert.equal(knownCity(data, "Cambridge", name)?.id, "cambridge-gb");
  assert.equal(knownCity(data, "Cambridge, United Kingdom", name)?.id, "cambridge-gb");
  assert.equal(knownCity(data, "Cambridge, GB", name)?.id, "cambridge-gb");
  assert.equal(knownCity(data, "Cambridge, US", name), undefined, "goes to the geocoder");
  assert.equal(knownCity(data, "London, CA", name), undefined);
  assert.equal(knownCity(data, "Dublin, US", name), undefined);
  assert.equal(knownCity(data, "Dublin, Ireland", name)?.id, "dublin-ie");
});

test("'Last lived in the others' keeps its answer when the home country sorts first (Gemini should-fix 5)", () => {
  // Austria is the first country in the data: home there is 0 years, the answer for the others is 5.
  const p = { label: "You", citizenships: [], newcomer: { yearsSinceResident: { AT: 0, BE: 5, DE: 5 } } };
  assert.equal(awayOf(p), "5");
  assert.equal(awayOf({ label: "You", citizenships: [], newcomer: { yearsSinceResident: { AT: 0, BE: "never" as const } } }), "never");
});

test("partial data: the share counts only lines that count for some city, so a passport not given is not a gap in the city", () => {
  const p = { ...defaultProfile(data), cities: ["lisbon-pt", "barcelona-es"], weights: { ...START_WEIGHTS, right_to_live: 15 } };
  const e = evaluate(data, p);
  for (const r of e.results) assert.equal(ownShare(r), 1, `${r.city.name}: every line that counts rests on its own figures`);
});

test("a link's place this browser lacks is named, not silently dropped, until a place of that name is added", () => {
  const p = { ...defaultProfile(data), cities: ["lisbon-pt"] };
  const s = { ...app(p), notFound: ["cambridge-massachusetts-us", "springfield-4250542-us"] };
  const v = text(verdict(s, evaluate(data, p)));
  assert.match(v, /The link also named Cambridge Massachusetts, US and Springfield, US, fetched in the sender's browser/);
  const none = { ...app({ ...p, cities: [] }), notFound: ["cambridge-massachusetts-us"] };
  assert.match(text(verdict(none, evaluate(data, none.profile))), /Add the cities you are weighing\. The link also named Cambridge Massachusetts, US/);
  const back = { ...p, cities: ["lisbon-pt", "cambridge-gb"] };
  assert.doesNotMatch(text(verdict({ ...app(back), notFound: ["cambridge-massachusetts-us"] }, evaluate(data, back))), /The link also named/);
});

test("a fetched place travels in the link under its own name, so Malmö is not read back as Malmo", () => {
  const malmo = { ...data.cities.find((c) => c.id === "lisbon-pt")!, id: "malmo-se", name: "Malmö", country: "SE" };
  const d = { ...data, cities: [...data.cities, malmo] };
  const names = fetchedNames(d, ["malmo-se"]);
  assert.deepEqual(names, { "malmo-se": "Malmö, SE" });
  const g = globalThis as { location?: unknown };
  const before = g.location;
  g.location = { href: "https://borgo.example/" };
  try {
    const url = shareUrl({ ...defaultProfile(data), cities: ["lisbon-pt", "malmo-se"] }, [], names);
    const sent = JSON.parse(Buffer.from(url.split("#share=")[1]!, "base64url").toString("utf8")) as { places?: Record<string, string> };
    assert.deepEqual(sent.places, { "malmo-se": "Malmö, SE" });
  } finally {
    g.location = before;
  }
  assert.equal(linkPlaceName("malmo-se", names), "Malmö, SE");
  assert.equal(linkPlaceName("malmo-se", {}), "Malmo, SE", "a link without names still names the place from its id");
});
