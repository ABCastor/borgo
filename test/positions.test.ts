// Position lines: the person says where they stand, a place scores by its distance, nothing is guessed, and the
// facts behind them (politics, abortion law, same-sex couples) reach any place in a covered country.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ROOT } from "../src/agent/dataset.ts";
import { buildProfile, parseStances } from "../src/agent/profile.ts";
import { CRITERIA, politicsWord, upgradeProfile } from "../src/core/criteria.ts";
import { evaluate } from "../src/core/engine.ts";
import type { City, Observation } from "../src/core/types.ts";
import { makeCtx } from "../src/fetch/context.ts";
import { politics, politicsFor } from "../src/fetch/politics.ts";
import { POLITICS } from "../src/fetch/politics-table.ts";
import { ABORTION, COUPLES, abortionLaw, couplesLaw } from "../src/fetch/rights-law.ts";
import { positionResult, type ElectionResult, type PartyEstimate } from "../pipeline/position-results.ts";
import { createServer } from "../src/mcp/server.ts";
import { fixture, profile } from "./fixture.ts";

process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "wtl-positions-test-"));

const ctx = makeCtx({ runtime: "node", fetch: () => Promise.reject(new Error("no network in this test")), now: () => new Date("2026-11-05T10:00:00Z") });
const place = (country: string, region?: string): City => ({ id: `x-${country}`, name: "X", country, ...(region ? { region } : {}), lat: 0, lon: 0 });
const obs = (metric: string, value: number, level: Observation["level"] = "country"): Observation => ({ metric, value, period: "2025", level, source: "test", retrieved: "2026-11-05" });

/** The fixture with a politics figure and an abortion fact per city. */
function withFacts() {
  const data = fixture();
  const facts: Record<string, [number, number]> = { "turin-it": [6.1, 4], "dublin-ie": [4.6, 4], "london-gb": [5.6, 2], "san-francisco-us": [6.4, 4] };
  for (const [id, [lr, ab]] of Object.entries(facts)) data.observations[id]!.push(obs("politics_lr", lr), obs("abortion_law", ab));
  return data;
}

test("position lines are off by default and have no score until the person says where they stand", () => {
  for (const c of CRITERIA.filter((x) => x.position)) assert.equal(c.defaultWeight, 0, c.id);
  const data = withFacts();
  const e = evaluate(data, profile({ weights: { politics: 20 } }));
  const line = e.results[0]!.lines.find((l) => l.id === "politics")!;
  assert.equal(line.score, null);
  assert.equal(line.points, 0);
  assert.match(line.raw.text, /say where you stand/);
});

test("a place scores by its distance from the stance, and a must-pass fails beyond the tolerance", () => {
  const data = withFacts();
  const p = profile({ weights: { politics: 20 }, stances: { politics: 4.5 } });
  const lines = Object.fromEntries(evaluate(data, p).results.map((r) => [r.city.id, r.lines.find((l) => l.id === "politics")!]));
  assert.equal(lines["dublin-ie"]!.raw.value!.toFixed(1), "0.1");
  assert.ok(lines["dublin-ie"]!.score! > lines["london-gb"]!.score! && lines["london-gb"]!.score! > lines["san-francisco-us"]!.score!);
  assert.match(lines["dublin-ie"]!.raw.text, /^centre-left, 4\.6 of 10$/);

  // Abortion law by step: two steps away scores nothing and fails as a must-pass.
  const q = profile({ weights: { abortion: 10 }, stances: { abortion: 4 }, dealBreakers: ["abortion"] });
  const r = evaluate(data, q).results;
  const london = r.find((x) => x.city.id === "london-gb")!;
  assert.equal(london.lines.find((l) => l.id === "abortion")!.score, 0);
  assert.deepEqual(london.ruledOut, ["Abortion law"]);
  assert.equal(r.at(-1)!.city.id, "london-gb");
  // The other way round: a person who wants the law of London rules the others out.
  const other = evaluate(data, profile({ weights: { abortion: 10 }, stances: { abortion: 2 }, dealBreakers: ["abortion"] })).results;
  assert.deepEqual(other.filter((x) => !x.ruledOut.length).map((x) => x.city.id), ["london-gb"]);
});

test("stances: numbers or a step's words, checked against the line's scale", () => {
  assert.deepEqual(parseStances({ politics: 3.5, couples_law: "marriage", abortion: "on request, 10" }), { politics: 3.5, couples_law: 3, abortion: 4 });
  assert.deepEqual(parseStances({ abortion: "2" }), { abortion: 2 });
  assert.throws(() => parseStances({ politics: 11 }), /0 Left to 10 Right/);
  assert.throws(() => parseStances({ clean_air: 3 }), /not a position line/);
  assert.throws(() => parseStances({ couples_law: "maybe" }), /0 Criminalised/);
  const built = buildProfile(fixture(), { cities: ["Torino", "Dublin"], stances: { politics: 3 } });
  assert.deepEqual(built.profile.stances, { politics: 3 });
  assert.ok(built.assumptions.some((a) => /weight is 0/.test(a)), "a stance on a line at weight 0 is pointed out");
  assert.equal(buildProfile(fixture(), { cities: ["Torino"] }).profile.stances, undefined, "nothing is assumed");
});

test("an old profile that weighted same-sex couples keeps its meaning as a stance; nothing else is added", () => {
  const up = upgradeProfile(profile({ weights: { couples_law: 5 }, prefs: { comfort: { min: 18, max: 27, basis: "feels" }, normalise: "absolute", missing: "average" } }));
  assert.deepEqual(up.stances, { couples_law: 3 });
  const none = upgradeProfile(profile({ prefs: { comfort: { min: 18, max: 27, basis: "feels" }, normalise: "absolute", missing: "average" } }));
  assert.equal(none.stances, undefined);
});

test("politics: a region with its own count first, then the country; dated and sourced", async () => {
  assert.equal(politicsFor(place("CH", "CH-ZH"))!.place, "CH-ZH");
  assert.equal(politicsFor(place("CH", "CH-ZH"))!.level, "region");
  assert.equal(politicsFor(place("CA", "CA-XX"))!.place, "CA");
  assert.equal(politicsFor(place("AE")), null, "no national elections with parties: no figure");
  // No expert positions for US or Singaporean parties, and no official result read for Spain or Greece: no figure at all.
  for (const c of ["US", "SG", "ES", "GR"]) assert.equal(politicsFor(place(c)), null, c);
  for (const c of ["HU", "IT", "JP"]) assert.equal(POLITICS[c]!.position, null, `${c}: under 75% of the vote has a position`);
  assert.deepEqual(await politics.fetch(place("IT"), ctx), []);
  const [o] = await politics.fetch(place("DE"), ctx);
  assert.equal(o!.metric, "politics_lr");
  assert.equal(o!.period, POLITICS.DE!.date);
  assert.match(o!.note!, /Bundestag.*2025/);
  for (const [k, p] of Object.entries(POLITICS)) {
    if (p.position !== null) assert.ok(p.position >= 0 && p.position <= 10 && p.covered >= 0.75, k);
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, k);
    assert.equal(p.source, "official", k);
    assert.ok(p.url.startsWith("https://") && p.checked >= p.date, k);
    for (const x of p.parties) assert.ok(x.basis === null || ["expert", "family", "members"].includes(x.basis), `${k} ${x.name}`);
  }
  assert.match(o!.note!, /^Estimate from the official result/);
  assert.equal(politicsWord(1.4), "far left");
  assert.equal(politicsWord(8.6), "far right");
});

test("abortion law: US states never borrow a national figure; Northern Ireland has its own law", async () => {
  assert.equal(abortionLaw.covers!(place("US", "US-TX")), true);
  assert.equal(abortionLaw.covers!(place("US", "US-OH")), false);
  assert.equal(abortionLaw.covers!(place("US")), false);
  const [ni] = await abortionLaw.fetch(place("GB", "GB-NIR"), ctx);
  const [eng] = await abortionLaw.fetch(place("GB", "GB-ENG"), ctx);
  assert.equal(ni!.value, 4);
  assert.equal(eng!.value, 2);
  assert.equal(ni!.level, "region");
  for (const [k, f] of Object.entries(ABORTION)) assert.ok(f.url.startsWith("https://") && f.law.length > 5 && (!f.checked || /^\d{4}-\d{2}-\d{2}$/.test(f.checked)), k);
  for (const [k, f] of Object.entries(COUPLES)) assert.ok((!f.url || f.url.startsWith("https://")) && (!f.note || !/verify/i.test(f.note)), k);
  assert.equal(couplesLaw.covers!(place("AE")), false, "no figure where the law could not be read");
  const [c] = await couplesLaw.fetch(place("IT"), ctx);
  assert.equal(c!.value, 2);
});

test("stale-fact round of 7 Nov 2026: each fact checked matches the words of its official text", () => {
  // https://www.nysenate.gov/legislation/laws/PBH/2599-BB: "the patient is within twenty-four weeks from the
  // commencement of pregnancy, or there is an absence of fetal viability, or the abortion is necessary to protect the
  // patient's life or health."
  const ny = ABORTION["US-NY"]!;
  assert.equal(ny.level, 4);
  assert.match(ny.text, /24 weeks/);
  assert.match(ny.text, /not viable/, "the viability ground applies after 24 weeks too");
  assert.match(ny.text, /life or health/);
  // https://www.finlex.fi/fi/laki/ajantasa/1929/19290234 1 §: "Kaksi henkilöä, jotka ovat sopineet menevänsä
  // avioliittoon keskenään" (20.2.2015/156, "Tämä laki tulee voimaan 1 päivänä maaliskuuta 2017").
  assert.equal(COUPLES.FI!.standing, 3);
  assert.match(COUPLES.FI!.law, /in force 1 March 2017/);
  for (const f of [ny, COUPLES.FI!]) assert.equal(f.checked, "2026-11-07");
});

test("stale-fact round of 8 Nov 2026: Canada and Australia match the words of their official texts", () => {
  // https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/288/index.do: "I would strike down s. 251 of the Criminal Code
  // as having no force or effect under s. 52(1) of the Constitution Act, 1982"; "Appeal allowed and acquittals restored".
  // https://laws-lois.justice.gc.ca/eng/acts/C-46/section-287.html: "287 [Repealed, 2019, c. 25, s. 111]".
  const ca = ABORTION.CA!;
  assert.equal(ca.level, 4);
  assert.match(ca.text, /no criminal law restricts it/);
  assert.match(ca.law, /S\.C\. 2019, c\. 25, s\. 111/);
  // Each state's limit, in its statute on the official register:
  // NSW https://legislation.nsw.gov.au/view/whole/html/inforce/current/act-2019-011 s. 5: "not more than 22 weeks pregnant";
  // Vic https://www.legislation.vic.gov.au/in-force/acts/abortion-law-reform-act-2008 s. 4: "not more than 24 weeks pregnant";
  // Qld https://www.legislation.qld.gov.au/view/pdf/inforce/current/act-2018-023 s. 5: "not more than 22 weeks pregnant";
  // SA https://www.legislation.sa.gov.au/lz?path=/c/a/termination%20of%20pregnancy%20act%202021 s. 5: "not more than
  // 22 weeks and 6 days pregnant"; WA https://www.legislation.wa.gov.au/legislation/statutes.nsf/RedirectURL?OpenAgent&query=mrcmp_49344.pdf
  // s. 202MC: "not more than 23 weeks pregnant"; Tas https://www.legislation.tas.gov.au/view/html/inforce/current/act-2013-072
  // s. 4: "Terminations by medical practitioner at not more than 16 weeks"; NT
  // https://legislation.nt.gov.au/Legislation/TERMINATION-OF-PREGNANCY-LAW-REFORM-ACT-2017 s. 7: "not more than 24 weeks
  // pregnant, if the medical practitioner considers the termination is appropriate in all the circumstances"; ACT
  // https://www.legislation.act.gov.au/a/1993-13/ Health Act 1993 pt 6 regulates who and where, and names no week.
  const au = ABORTION.AU!;
  assert.equal(au.level, 4);
  for (const limit of [/16 weeks in Tasmania/, /22 in New South Wales and Queensland/, /22 weeks and 6 days in South Australia/, /23 in Western Australia/, /24 in Victoria and the Northern Territory/, /appropriate in all the circumstances/, /the ACT sets no time limit/]) assert.match(au.text, limit);
  assert.doesNotMatch(au.text, /16 to 24/, "the old range missed the ACT, which has no limit");
  for (const f of [ca, au]) assert.equal(f.checked, "2026-11-08");
});

test("cli and mcp take stances", async () => {
  const out = execFileSync(process.execPath, [join(ROOT, "bin/where-to-live.ts"), "compare", "Torino", "Dublin", "--weight", "politics=20", "--stance", "politics=4", "--json", "--full"], { cwd: ROOT, encoding: "utf8" });
  const r = JSON.parse(out) as { profile: { stances: Record<string, number> }; ranking: { id: string }[] };
  assert.deepEqual(r.profile.stances, { politics: 4 });
  assert.equal(r.ranking.length, 2);

  const server = createServer(fixture());
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const res = await client.callTool({ name: "compare_cities", arguments: { cities: ["Turin", "Dublin"], weights: { couples_law: 10 }, stances: { couples_law: "marriage" }, detail: "full" } });
  assert.notEqual(res.isError, true);
  const s = res.structuredContent as { profile: { stances: Record<string, number> } };
  assert.deepEqual(s.profile.stances, { couples_law: 3 });
  const bad = await client.callTool({ name: "compare_cities", arguments: { cities: ["Turin"], stances: { politics: 42 } } });
  assert.equal(bad.isError, true);
  await client.close();
});

test("politics arithmetic: official votes, ParlGov positions, nothing imputed", () => {
  const pg = new Map<number, PartyEstimate>([
    [1, { id: 1, country: "XX", name: "A", position: 2, family: false }],
    [2, { id: 2, country: "XX", name: "B", position: 8, family: true }],
    [3, { id: 3, country: "XX", name: "C", position: 6, family: false }],
    [9, { id: 9, country: "YY", name: "Elsewhere", position: 5, family: false }],
  ]);
  const r = (votes: ElectionResult["votes"], valid = 100): ElectionResult => ({ place: "XX", election: "Test", date: "2026-01-01", url: "https://example.org", checked: "2026-11-05", valid, votes });
  const p = positionResult(r([{ name: "A", votes: 40, parlgov: [1] }, { name: "B", votes: 30, parlgov: [2] }, { name: "AC", votes: 10, parlgov: [1, 3] }, { name: "New", votes: 15 }]), pg);
  // (40*2 + 30*8 + 10*4) / 80, over the 80% with a position; the 15% without one and 5% unlisted stay in the denominator.
  assert.equal(p.position, 4.5);
  assert.equal(p.covered, 0.8);
  assert.deepEqual(p.parties.map((x) => [x.name, x.share, x.basis]), [["A", 40, "expert"], ["B", 30, "family"], ["New", 15, null], ["AC", 10, "members"]]);
  // Under 75% with a position: no figure, never a midpoint.
  assert.equal(positionResult(r([{ name: "A", votes: 40, parlgov: [1] }, { name: "New", votes: 60 }]), pg).position, null);
  assert.throws(() => positionResult(r([{ name: "X", votes: 50, parlgov: [9] }]), pg), /is in YY/);
  assert.throws(() => positionResult(r([{ name: "X", votes: 50, parlgov: [7] }]), pg), /no left-right figure/);
  assert.throws(() => positionResult(r([{ name: "A", votes: 900, parlgov: [1] }], 800), pg), /exceed valid/);
});
