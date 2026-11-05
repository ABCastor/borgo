// The budget boundary through every face (the engine profile, the CLI, the MCP server, the app's state) and the
// ranking's honesty: a premium entered a month stays a month, a year is converted out loud or refused without its
// period, spending never holds housing, childcare or health, paid childcare can be switched off, a pension share says
// how it is treated, and a lead missing figures could change is provisional.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ROOT } from "../src/agent/dataset.ts";
import { methodology } from "../src/agent/methodology.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { catalogue, compare, netPay, summarize } from "../src/agent/report.ts";
import { compareArgs } from "../src/cli/main.ts";
import { CRITERIA } from "../src/core/criteria.ts";
import { evaluate, weightOf } from "../src/core/engine.ts";
import { money } from "../src/core/money.ts";
import type { Dataset, Profile } from "../src/core/types.ts";
import { createServer } from "../src/mcp/server.ts";
import { storedOverride } from "../src/ui/state.ts";
import { TERMS } from "../src/ui/terms.ts";
import { verdict } from "../src/ui/top.ts";
import { fixture, profile } from "./fixture.ts";

process.env.BORGO_HOME = mkdtempSync(join(tmpdir(), "borgo-faces-"));
const data = fixture();
const sf = (d: Dataset) => d.cities.find((c) => c.id === "san-francisco-us")!;
const only = (w: Record<string, number>) => ({ ...Object.fromEntries(CRITERIA.map((c) => [c.id, 0])), ...w });
const cli = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, "bin/borgo.ts"), ...args], { cwd: ROOT, encoding: "utf8" });
const flags = (o: Record<string, unknown>) => o as Parameters<typeof compareArgs>[1];

async function connected(d: Dataset): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(d).connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return client;
}

// ---------- the health premium, a month ----------

test("health premium: 300 a month is 300 a month in every face, and 3,600 a year is said as 300 a month", async () => {
  // The fixture has no out-of-pocket figure for San Francisco, so the health line is the premium alone.
  const health = (p: Profile) => money(data, p, sf(data)).health!.monthly;
  // Engine profile: the override is a month.
  assert.equal(health(profile({ overrides: { "san-francisco-us": { health_premium: 300 } } })), 300);
  // The agents' profile builder: a month stays, a year is divided by 12 and said in the assumptions.
  const month = buildProfile(data, { cities: ["San Francisco"], healthPremium: { "San Francisco": { amount: 300, per: "month" } } });
  assert.equal(month.profile.overrides["san-francisco-us"]!.health_premium, 300);
  const year = buildProfile(data, { cities: ["San Francisco"], healthPremium: { "San Francisco": { amount: 3_600, per: "year" } } });
  assert.equal(year.profile.overrides["san-francisco-us"]!.health_premium, 300);
  assert.ok(year.assumptions.some((a) => /3,600 a year is counted as 300 a month/.test(a)));
  assert.throws(() => buildProfile(data, { cities: ["San Francisco"], healthPremium: { "San Francisco": { amount: 3_600 } as never } }), /per must be "month" or "year"/);
  assert.throws(() => buildProfile(data, { cities: ["San Francisco"], healthPremium: { "San Francisco": { amount: 300, per: "month" } }, overrides: { "San Francisco": { health_premium: 300 } } }), /both set it/);
  // CLI: the flag needs its period.
  const a = compareArgs(["San Francisco"], flags({ "health-premium": ["San Francisco=3600/year"] }));
  assert.deepEqual(a.healthPremium, { "San Francisco": { amount: 3_600, per: "year" } });
  assert.equal(compare(data, a).cities[0]!.money.monthly.health.local, 300);
  assert.equal(compare(data, compareArgs(["San Francisco"], flags({ "health-premium": ["San Francisco=300/month"] }))).cities[0]!.money.monthly.health.local, 300);
  const refused = cli("compare", "San Francisco", "--health-premium", "San Francisco=3600", "--json");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /needs its period/);
  // MCP: the argument carries its period, and one without it is refused before any money is worked out.
  const client = await connected(data);
  const r = await client.callTool({ name: "compare_cities", arguments: { cities: ["San Francisco"], detail: "full", healthPremium: { "San Francisco": { amount: 3_600, per: "year" } } } });
  assert.notEqual(r.isError, true);
  assert.equal((r.structuredContent as { cities: { money: { monthly: { health: { local: number } } } }[] }).cities[0]!.money.monthly.health.local, 300);
  const bad = await client.callTool({ name: "compare_cities", arguments: { cities: ["San Francisco"], healthPremium: { "San Francisco": { amount: 3_600 } } } });
  assert.equal(bad.isError, true);
  // The app: its number popover saves a month as typed and a year as a twelfth, through the same conversion.
  assert.equal(storedOverride("/month", 300, "month"), 300);
  assert.equal(storedOverride("/month", 3_600, "year"), 300);
  assert.equal(storedOverride("/year", 12_000, "year"), 12_000, "an annual metric stays as entered");
});

test("spending excludes housing, childcare and health in every face", async () => {
  const says = /except housing, childcare and health|rent, childcare and health aside/;
  assert.match(cli("--help").stdout, /a month, on everything except housing, childcare and health/);
  const client = await connected(data);
  const tools = await client.listTools();
  const spending = (tools.tools.find((t) => t.name === "compare_cities")!.inputSchema.properties as Record<string, { description?: string }>).spending!.description!;
  assert.match(spending, says);
  assert.match(TERMS.everyday!, says);
  assert.match(methodology(data), /everyday spending[^.]*(except housing, childcare and health)/);
  // The engine counts them apart: childcare and health are their own lines in the month, never inside spending.
  const m = money(data, profile({ children: [2], overrides: { "san-francisco-us": { health_premium: 300, childcare_cost: 1_000 } } }), sf(data));
  assert.equal(m.monthlyCost, m.rent!.monthly + m.everyday!.monthly + 1_000 + 300);
});

// ---------- childcare ----------

test("childcare: paid care can be switched off in every face, and the household's own cost replaces the reference", async () => {
  const kids = profile({ children: [2] });
  const turin = data.cities.find((c) => c.id === "turin-it")!;
  // The fixture has no OECD figure: with paid care on, childcare is named as left out; off, nothing is due.
  assert.ok(money(data, kids, turin).costCompleteness.missing.some((x) => x.startsWith("childcare")));
  const off = money(data, { ...kids, paidChildcare: false }, turin);
  assert.equal(off.childcare, null);
  assert.equal(off.costCompleteness.status, "complete");
  assert.equal(weightOf({ ...kids, paidChildcare: false }, CRITERIA.find((c) => c.id === "childcare")!), 0);
  // The household's own figure, a month.
  const own = money(data, { ...kids, overrides: { "turin-it": { childcare_cost: 650 } } }, turin);
  assert.equal(own.childcare?.monthly, 650);
  assert.equal(own.childcare?.how, "your own childcare cost");
  // CLI and MCP: the switch and the cost with its period.
  const a = compareArgs(["Turin"], flags({ children: "2", "no-paid-childcare": true, "childcare-cost": ["Turin=7800/year"] }));
  assert.equal(a.paidChildcare, false);
  assert.deepEqual(a.childcareCost, { Turin: { amount: 7_800, per: "year" } });
  const built = buildProfile(data, a).profile;
  assert.equal(built.paidChildcare, false);
  assert.equal(built.overrides["turin-it"]!.childcare_cost, 650);
  const client = await connected(data);
  const r = await client.callTool({ name: "compare_cities", arguments: { cities: ["Turin"], children: [2], paidChildcare: false, salary: { amount: 40_000 }, spending: { amount: 900, homeCity: "Turin" } } });
  const c = (r.structuredContent as { cities: { money: { paidChildcare?: boolean; costMonth: number } }[] }).cities[0]!;
  assert.equal(c.money.paidChildcare, false);
  assert.match((r.content as { text: string }[])[0]!.text, /No paid childcare: no childcare cost is counted/);
});

// ---------- pensions ----------

test("pension: every face says where relief is modelled and where the share is only counted as saving", async () => {
  const plans = catalogue(data).pensions;
  assert.equal(plans.find((x) => x.country === "US")!.status, "modelled");
  assert.equal(plans.find((x) => x.country === "AT")!.status, "not modelled");
  assert.equal(plans.find((x) => x.country === "SE")!.status, "no relief");
  const at = netPay(data, { country: "AT", gross: 60_000, pension: 0.05 });
  assert.equal(at.pensionRelief?.status, "not modelled");
  assert.match(at.pensionRelief!.text, /not modelled, counted as saving/);
  assert.equal(netPay(data, { country: "AT", gross: 60_000 }).pensionRelief, null, "said only when a share is set");
  const s = summarize(compare(data, { cities: ["Turin"], salary: { amount: 60_000 }, pension: 0.05 }));
  assert.match(s.cities[0]!.money!.pensionRelief!, /fondo pensione: tax relief modelled/);
  const client = await connected(data);
  const tools = await client.listTools();
  const desc = (tools.tools.find((t) => t.name === "compare_cities")!.inputSchema.properties as Record<string, { description?: string }>).pension!.description!;
  assert.match(desc, /US \(401\(k\)\)/);
  assert.match(desc, /elsewhere it is not modelled and the share is counted as saving/);
  const atCli = cli("net-pay", "AT", "60000", "--pension", "5%");
  assert.match(atCli.stdout, /Pension: pension savings: not modelled, counted as saving with no tax relief/);
});

// ---------- ranking honesty ----------

test("a lead that a missing figure could change is provisional (the reviewer's 70/30 example)", () => {
  // Own lines 1-5 score (v - 1) / 4. A = (0.5, 0.8), B = (0.6, missing), C = (0, 0); weights 70 and 30.
  // B's gap is scored at the lowest compared score, 0, so B = 42 and A = 0.35 + 0.24 = 59 leads; at the highest
  // observed (0.8) B would be 66. B's range 42-66 reaches above A's 59: the lead is provisional.
  const d = fixture();
  const cities = ["turin-it", "dublin-ie", "london-gb"];
  const p = profile({
    cities,
    personal: [
      { id: "you_a", label: "One", scores: { "turin-it": 3, "dublin-ie": 3.4, "london-gb": 1 } },
      { id: "you_b", label: "Two", scores: { "turin-it": 4.2, "london-gb": 1 } },
    ],
    weights: only({ you_a: 70, you_b: 30 }),
    prefs: { ...profile().prefs, missing: "lowest" },
  });
  const e = evaluate(d, p);
  const by = (id: string) => e.results.find((r) => r.city.id === id)!;
  assert.ok(Math.abs(by("turin-it").total - 59) < 1e-9);
  assert.ok(Math.abs(by("dublin-ie").total - 42) < 1e-9);
  assert.ok(Math.abs(by("dublin-ie").bounds.low - 42) < 1e-9);
  assert.ok(Math.abs(by("dublin-ie").bounds.high - 66) < 1e-9);
  assert.equal(e.results[0]!.city.id, "turin-it");
  assert.equal(e.provisional, true);
  assert.deepEqual(e.rivals, ["Dublin"]);
  assert.match(e.provisionalReasons.join(" "), /Two: no figure for Dublin/);
  // Falsifier: with Dublin's figure given the lead is settled.
  const settled = evaluate(d, { ...p, personal: [p.personal[0]!, { ...p.personal[1]!, scores: { ...p.personal[1]!.scores, "dublin-ie": 1 } }] });
  assert.equal(settled.provisional, false);
});

test("money compared on take-home pay says so, coverage of the money asked for drops, and the verdict is provisional where it could change", () => {
  // Dublin pays more but its rent leaves less: on take-home pay it leads, on money left (as asked) Torino does.
  const d = fixture();
  d.observations["london-gb"] = d.observations["london-gb"]!.filter((o) => o.metric !== "rent_1bed");
  const p = profile({
    cities: ["turin-it", "dublin-ie", "london-gb"],
    weights: only({ money_left: 20 }),
    income: { ...profile().income, mode: "per-city", perCity: { "dublin-ie": { gross: 120_000, currency: "EUR" } } },
    overrides: { "dublin-ie": { rent_1bed: 7_000 } },
  });
  const e = evaluate(d, p);
  assert.deepEqual(e.moneyBasis, { requested: "money_left", used: "net_pay" });
  assert.equal(e.results[0]!.city.id, "dublin-ie");
  const dub = e.results[0]!;
  assert.equal(dub.coverage, 1, "scored on observed take-home pay");
  assert.equal(dub.requestedCoverage, 1, "Dublin's own money left is known");
  const lon = e.results.find((r) => r.city.id === "london-gb")!;
  assert.equal(lon.requestedCoverage, 0, "London's money left is not");
  assert.equal(e.provisional, true);
  const r = compare(d, { cities: ["Turin", "Dublin", "London"], only: ["money_left"], salaryByCity: { Dublin: { amount: 120_000 } }, salary: { amount: 60_000 }, spending: { amount: 900, homeCity: "Turin" }, overrides: { Dublin: { rent_1bed: 7_000 } } });
  assert.equal(r.provisional, true);
  assert.match(r.verdict, /^Provisional: Dublin leads for now/);
  assert.match(r.verdict, /Money was compared on take-home pay only/);
  // The app's verdict says the same in plain words.
  const ui = verdict({ data: d, profile: p, view: "cities", city: null, measure: "air", valuesOpen: false, openGroups: [], live: null, fetchedHere: [], taxOpen: [], moreOpen: false, shareInclude: [] }, e).value.replace(/<[^>]+>/g, "");
  assert.match(ui, /Provisional: Dublin leads for now/);
  assert.match(ui, /The lead is not settled: [^.]*Torino[^.]* could still overtake it/);
  assert.match(ui, /Money was compared on take-home pay only/);
});

test("money that counts for no city makes the lead provisional, and says what blocks take-home pay too", () => {
  // San Francisco buys cover outside pay and gives no premium; Dublin has no rent: no money basis is fair to both.
  // San Francisco leads on the gut line (4 against 3, so 75 against 50); Dublin's unknown money could take it to 75,
  // above San Francisco's lowest (37.5), so the lead is provisional. San Francisco's own money is at most what it
  // shows before the premium, which caps its high at 41.8: had Dublin led, San Francisco could not have overtaken.
  const d = fixture();
  d.observations["dublin-ie"] = d.observations["dublin-ie"]!.filter((o) => o.metric !== "rent_1bed");
  const p = profile({ cities: ["dublin-ie", "san-francisco-us"], weights: only({ money_left: 50, you_a: 50 }), personal: [{ id: "you_a", label: "Gut", scores: { "dublin-ie": 3, "san-francisco-us": 4 } }] });
  const e = evaluate(d, p);
  assert.deepEqual(e.moneyBasis, { requested: "money_left", used: "none" });
  assert.equal(e.provisional, true);
  assert.match(e.provisionalReasons.join(" "), /Money left each month: no whole figure/);
  const note = e.notes.find((n) => n.startsWith("Money left each month is left out"))!;
  assert.match(note, /Take-home pay cannot stand in either: add the health premium you pay outside pay for San Francisco\./);
  // With the premium given, take-home pay stands in and the note names only the rent.
  const given = evaluate(d, { ...p, overrides: { "san-francisco-us": { health_premium: 400 } } });
  assert.equal(given.moneyBasis?.used, "net_pay");
});
