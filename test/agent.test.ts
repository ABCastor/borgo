import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { findCity, searchCities } from "../src/agent/cities.ts";
import { chartInput, compareSvg } from "../src/agent/chart.ts";
import { ROOT } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { compare, netPay } from "../src/agent/report.ts";
import { createServer } from "../src/mcp/server.ts";
import { VIEW_MIME, VIEW_URI } from "../src/mcp/view.ts";
import { fixture } from "./fixture.ts";

// The CLI reads the person's cache of fetched places; tests get an empty one of their own.
process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "wtl-agent-test-"));

const data = fixture();
const CLI = join(ROOT, "bin/borgo.ts");
const CLI_OLD_NAME = join(ROOT, "bin/where-to-live.ts");

test("cities: ids, names, aliases, accents, typos and a country suffix", () => {
  assert.equal(findCity(data, "turin-it").id, "turin-it");
  assert.equal(findCity(data, "Turin").id, "turin-it");
  assert.equal(findCity(data, "dublin, IE").id, "dublin-ie");
  assert.equal(findCity(data, "San Fransisco").id, "san-francisco-us");
  assert.equal(searchCities(data, "", { country: "GB" })[0]!.city.id, "london-gb");
  assert.throws(() => findCity(data, "Atlantis"), /No city matches "Atlantis"/);
  assert.throws(() => findCity(data, "on"), /No city matches/); // too short to guess from

});

test("profile: simple arguments become a full profile, and every default is said out loud", () => {
  const { profile, assumptions } = buildProfile(data, {
    cities: ["Torino", "Dublin"],
    salaryByCity: { Dublin: { amount: 80_000 } },
    household: [{ passports: ["it"] }],
    overrides: { Dublin: { rent_1bed: 2_000 } },
    personal: [{ label: "Family nearby", scores: { Torino: 5, Dublin: 2 } }],
    dealBreakers: ["right_to_live"],
  });
  assert.deepEqual(profile.cities, ["turin-it", "dublin-ie"]);
  assert.equal(profile.income.mode, "per-city");
  assert.deepEqual(profile.income.perCity["dublin-ie"], { gross: 80_000, currency: "EUR" });
  assert.deepEqual(profile.household[0]!.citizenships, ["IT"]);
  assert.equal(profile.overrides["dublin-ie"]!.rent_1bed, 2_000);
  assert.equal(profile.personal[0]!.scores["turin-it"], 5);
  assert.ok(assumptions.some((a) => a.includes("No monthly spending")));
  assert.throws(() => buildProfile(data, { cities: ["Turin"], weights: { charm: 5 } }), /Unknown criterion "charm"/);
  assert.throws(() => buildProfile(data, { cities: ["Turin"], preset: "hedonist" }), /Unknown preset/);
  assert.throws(() => buildProfile(data, { cities: ["Turin"], overrides: { Turin: { rent: 900 } } }), /Unknown metric "rent"/);
});

test("compare: the engine's ranking, with reasons, money and what to add", () => {
  const r = compare(data, { cities: ["Turin", "Dublin", "London"], household: [{ passports: ["IT"] }], salary: { amount: 60_000 }, spending: { amount: 900, homeCity: "Turin" }, dealBreakers: ["right_to_live"] });
  assert.equal(r.ranking.at(-1)!.id, "london-gb"); // an Italian passport needs a visa for the UK
  assert.deepEqual(r.ranking.at(-1)!.ruledOut, ["Everyone can move there"]);
  const dublin = r.cities.find((c) => c.id === "dublin-ie")!;
  assert.equal(dublin.money.monthly.rent.local, 2200);
  assert.equal(dublin.money.rentSource!.source!.id, "test");
  assert.ok(dublin.lines.every((l) => typeof l.points === "number"));
  assert.ok(dublin.why.length > 0);
  assert.ok(r.whatToAdd.some((x) => x.includes("1-5 lines")));
});

test("net pay: by city sets the region; currencies convert; unknown countries say which exist", () => {
  const r = netPay(data, { city: "Turin", gross: 60_000 });
  assert.equal(r.country, "IT");
  assert.equal(r.region, "IT-21");
  assert.ok(r.net > 30_000 && r.net < 50_000);
  assert.ok(r.caveats.length > 0 && r.sources.length > 0);
  const gbp = netPay(data, { country: "GB", gross: 70_000, currency: "EUR" });
  assert.equal(gbp.gross, 70_000 * 0.85);
  assert.throws(() => netPay(data, { country: "MX", gross: 1 }), /No take-home pay model for MX yet\. Models: IT/);
});

test("chart: one bar per city, money panel when there is money", () => {
  const r = compare(data, { cities: ["Turin", "Dublin"], salary: { amount: 60_000 }, spending: { amount: 900 }, overrides: { Turin: { rent_1bed: 800 } } });
  const svg = compareSvg(chartInput(r));
  assert.match(svg, /^<svg[^>]+viewBox/);
  assert.match(svg, /Money left each month, EUR/);
  assert.ok(svg.includes(">Torino<") && svg.includes(">Dublin<"));
});

async function connected(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(data).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const text = (r: object) => ((r as { content: { text: string }[] }).content)[0]!.text;

test("mcp: tools are listed, and compare_cities points at the chart view", async () => {
  const client = await connected();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["compare_cities", "fetch_city", "get_city", "list_metrics_and_sources", "list_sources", "list_stale", "methodology", "net_pay", "propose_change", "record_observation", "search_cities"]);
  const cmp = tools.find((t) => t.name === "compare_cities")!;
  assert.equal((cmp._meta as { ui: { resourceUri: string } }).ui.resourceUri, VIEW_URI);
  assert.equal(cmp.annotations?.readOnlyHint, true);
  assert.match(client.getInstructions() ?? "", /^Borgo compares/);
  assert.match(client.getInstructions() ?? "", /where to live/);
  assert.equal(client.getServerVersion()?.name, "borgo");
  const view = await client.readResource({ uri: VIEW_URI });
  const c = view.contents[0]! as { mimeType: string; text: string };
  assert.equal(c.mimeType, VIEW_MIME);
  assert.match(c.text, /^<!doctype html>/);
  assert.match(c.text, /ui\/initialize/);
  assert.ok(c.text.includes("function compareSvg(") && !c.text.includes(": ChartInput"), "the chart code is inlined with its types stripped");
  await client.close();
});

test("mcp: compare_cities returns markdown tables and the structured report", async () => {
  const client = await connected();
  const r = await client.callTool({ name: "compare_cities", arguments: { cities: ["Turin", "Dublin", "San Francisco"], household: [{ passports: ["IT"] }], salary: { amount: 60000, currency: "EUR" }, spending: { amount: 900, homeCity: "Turin" } } });
  assert.notEqual(r.isError, true);
  assert.match(text(r), /\| # \| City \| Score \/100 \|/);
  assert.match(text(r), /### Money, in EUR/);
  const s = r.structuredContent as { ranking: { id: string }[]; cities: { lines: unknown[]; money: unknown }[]; whatToAdd: string[] };
  assert.equal(s.ranking.length, 3);
  assert.ok(s.cities.every((c) => c.lines.length > 0 && c.money));
  const bad = await client.callTool({ name: "compare_cities", arguments: { cities: ["Atlantis"] } });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /No city matches/);
  await client.close();
});

test("mcp: net_pay answers with every tax line, caveats and sources", async () => {
  const client = await connected();
  const r = await client.callTool({ name: "net_pay", arguments: { country: "IE", gross: 70000 } });
  assert.match(text(r), /Take-home/);
  const s = r.structuredContent as { country: string; net: number; lines: unknown[]; caveats: string[]; sources: unknown[] };
  assert.equal(s.country, "IE");
  assert.ok(s.net > 0 && s.lines.length >= 2 && s.sources.length > 0);
  await client.close();
});

test("mcp: the stdio server starts on the real dataset and answers", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: ROOT, stderr: "ignore" });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const r = await client.callTool({ name: "search_cities", arguments: { query: "Torino" } });
  assert.equal((r.structuredContent as { cities: { id: string }[] }).cities[0]!.id, "turin-it");
  await client.close();
});

test("cli: compare --json gives the same report agents get", () => {
  const out = execFileSync(process.execPath, [CLI, "compare", "Torino", "Dublin", "--person", "IT", "--salary", "60k EUR", "--spending", "1200", "--home", "Torino", "--weight", "clean_air=30", "--json", "--full"], { cwd: ROOT, encoding: "utf8" });
  const r = JSON.parse(out) as { ranking: { id: string }[]; profile: { weights: Record<string, number>; income: { gross: number } }; cities: { money: { yearly: { net: { local: number } } } }[] };
  assert.deepEqual(r.ranking.map((x) => x.id).sort(), ["dublin-ie", "turin-it"]);
  assert.equal(r.profile.weights.clean_air, 30);
  assert.equal(r.profile.income.gross, 60_000);
  assert.ok(r.cities.every((c) => c.money.yearly.net.local > 0));
});

test("cli: errors are JSON with --json and exit non-zero", () => {
  assert.throws(
    () => execFileSync(process.execPath, [CLI, "compare", "Atlantis", "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    (e: { status: number; stdout: string }) => e.status === 1 && /No city matches/.test(JSON.parse(e.stdout).error),
  );
});

test("profile: a partner's pay, ages, children, pension and regimes as arguments", () => {
  const { profile } = buildProfile(data, {
    cities: ["Turin", "Dublin"],
    household: [{ passports: ["IT"], age: 34 }, { passports: ["IT"], age: 33, spouse: true, salary: { amount: 30_000, currency: "EUR" }, salaryByCity: { Dublin: { amount: 40_000 } }, pension: 0.03 }],
    salary: { amount: 60_000, currency: "EUR" },
    pension: 0.05,
    children: [2, 7],
    regimes: { it: "it-impatriati", ie: "none" },
  });
  assert.equal(profile.income.pension, 0.05);
  assert.deepEqual(profile.children, [2, 7]);
  assert.deepEqual(profile.income.regimes, { IT: "it-impatriati", IE: "none" });
  assert.equal(profile.household[0]!.newcomer?.age, 34);
  assert.equal(profile.household[0]!.newcomer?.minorChildren, 2);
  const partner = profile.household[1]!;
  assert.equal(partner.spouse, true);
  assert.equal(partner.relation, "partner");
  assert.deepEqual(partner.pay, { gross: 30_000, currency: "EUR", mode: "per-city", perCity: { "dublin-ie": { gross: 40_000, currency: "EUR" } }, pension: 0.03 });
  assert.throws(() => buildProfile(data, { cities: ["Turin"], regimes: { IT: "es-beckham" } }), /Unknown regime "es-beckham" for IT\. Regimes there: .*it-impatriati/);
  assert.throws(() => buildProfile(data, { cities: ["Turin"], pension: 0.7 }), /0 to 0\.5/);
  assert.throws(() => buildProfile(data, { cities: ["Turin"], household: [{ passports: ["IT"], salary: { amount: 1 } }] }), /first person's pay is `salary`/);
});

test("compare: each earner, pension, childcare, health, leave and break-even in the report", () => {
  const r = compare(data, {
    cities: ["Turin", "London"],
    household: [{ passports: ["IT"] }, { passports: ["IT"], salary: { amount: 30_000, currency: "EUR" } }],
    salary: { amount: 60_000, currency: "EUR" },
    pension: 0.05,
    spending: { amount: 1_500, currency: "EUR", homeCity: "Turin" },
  });
  const london = r.cities.find((c) => c.id === "london-gb")!.money;
  assert.equal(london.earners.length, 2);
  assert.ok(london.monthly.pension.local! > 0);
  assert.ok(london.breakEven && london.breakEven.gross.local! > 0 && london.breakEven.home === "turin-it");
  assert.equal(r.cities.find((c) => c.id === "turin-it")!.money.breakEven, null);
  assert.ok("holidayDays" in london.leave && Array.isArray(london.gaps));
});

test("net pay: age, children, pension, a regime and a married partner", () => {
  const alone = netPay(data, { country: "US", region: "US-CA", gross: 150_000 });
  const couple = netPay(data, { country: "US", region: "US-CA", gross: 150_000, partner: { gross: 0, spouse: true } });
  assert.equal(couple.filing?.mode, "joint");
  assert.ok(couple.net > alone.net);
  assert.ok(couple.lines.every((l) => !l.label.startsWith("Partner:") || l.amount !== 0), "a spouse with no pay brings no empty lines");
  const saver = netPay(data, { country: "US", gross: 150_000, pension: 0.1, age: 40, children: [3] });
  assert.equal(saver.pension, 15_000);
  assert.ok(saver.lines.some((l) => l.saving));
  const it = netPay(data, { country: "IT", gross: 80_000, regime: "it-impatriati" });
  assert.equal(it.regime?.id, "it-impatriati");
  assert.ok(it.net > netPay(data, { country: "IT", gross: 80_000 }).net);
  assert.throws(() => netPay(data, { country: "IT", gross: 80_000, regime: "es-beckham" }), /Unknown regime/);
});

test("mcp: compare_cities and net_pay take the household's money arguments; the catalogue lists regimes", async () => {
  const client = await connected();
  const r = await client.callTool({
    name: "compare_cities",
    arguments: { cities: ["Turin", "San Francisco"], household: [{ passports: ["IT"], age: 34 }, { passports: ["IT"], spouse: true }], salary: { amount: 90_000, currency: "EUR" }, children: [3], pension: 0.05, regimes: { IT: "none" }, detail: "full" },
  });
  assert.notEqual(r.isError, true, text(r));
  const sf = (r.structuredContent as { cities: { id: string; money: { filing: { mode: string } | null; earners: unknown[] } }[] }).cities.find((c) => c.id === "san-francisco-us")!;
  assert.equal(sf.money.filing?.mode, "joint");
  assert.match(text(r), /Childcare a month, after support/);
  const n = await client.callTool({ name: "net_pay", arguments: { country: "DE", gross: 80_000, age: 30, children: [1], pension: 0.04, partner: { gross: 20_000, spouse: true } } });
  assert.notEqual(n.isError, true, text(n));
  assert.match(text(n), /Filed jointly|Filed separately/);
  const c = await client.callTool({ name: "list_metrics_and_sources", arguments: {} });
  assert.ok((c.structuredContent as { regimes: { id: string }[] }).regimes.some((x) => x.id === "pt-ifici"));
  await client.close();
});

test("cli: --partner, --married, --age, --children, --pension and --regime", () => {
  const out = execFileSync(process.execPath, [CLI, "compare", "Torino", "Dublin", "--person", "IT", "--person", "IT", "--salary", "60k EUR", "--partner", "30k EUR", "--married", "--age", "34", "--children", "2,5", "--pension", "5%", "--regime", "IE:none", "--json", "--full"], { cwd: ROOT, encoding: "utf8" });
  const r = JSON.parse(out) as { profile: { income: { pension: number; regimes: Record<string, string> }; children: number[]; household: { spouse?: boolean; pay?: { gross: number }; newcomer?: { age?: number } }[] } };
  assert.equal(r.profile.income.pension, 0.05);
  assert.deepEqual(r.profile.children, [2, 5]);
  assert.deepEqual(r.profile.income.regimes, { IE: "none" });
  assert.equal(r.profile.household[0]!.newcomer?.age, 34);
  assert.equal(r.profile.household[1]!.spouse, true);
  assert.equal(r.profile.household[1]!.pay?.gross, 30_000);
  const np = JSON.parse(execFileSync(process.execPath, [CLI, "net-pay", "US", "150000", "--married", "--pension", "6", "--json"], { cwd: ROOT, encoding: "utf8" })) as { filing: { mode: string }; pension: number };
  assert.equal(np.filing.mode, "joint");
  assert.equal(np.pension, 9_000);
  // A partner's pay needs no passports: theirs, and yours, are then not checked rather than guessed.
  const pp = JSON.parse(execFileSync(process.execPath, [CLI, "compare", "Torino", "--partner", "30k", "--json", "--full"], { cwd: ROOT, encoding: "utf8" })) as { profile: { household: { citizenships: string[]; pay?: { gross: number } }[] }; assumptions: string[] };
  assert.deepEqual(pp.profile.household.map((p) => p.citizenships), [[], []]);
  assert.equal(pp.profile.household[1]!.pay?.gross, 30_000);
  assert.ok(pp.assumptions.some((a) => /No passports given for Person 2/.test(a)));
});

test("cli: borgo and its other name, where-to-live, are the same command", () => {
  const help = execFileSync(process.execPath, [CLI, "--help"], { cwd: ROOT, encoding: "utf8" });
  assert.match(help, /^borgo: compare cities/);
  assert.equal(execFileSync(process.execPath, [CLI_OLD_NAME, "--help"], { cwd: ROOT, encoding: "utf8" }), help);
});
