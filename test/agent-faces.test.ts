// The agent faces: inputs checked at the shared boundary with readable errors, compact answers by default, and the
// discovery calls an agent needs to use the tools from their descriptions alone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { matchCity } from "../src/agent/cities.ts";
import { loadDataset, ROOT } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { cityReport, compare, netPay, REPORT_VERSION, summarize } from "../src/agent/report.ts";
import { createServer } from "../src/mcp/server.ts";
import type { Dataset } from "../src/core/types.ts";
import { fixture } from "./fixture.ts";

process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "wtl-faces-test-"));
process.env.BORGO_HOME = process.env.WHERE_TO_LIVE_HOME;
const CLI = join(ROOT, "bin/borgo.ts");
const data = fixture();
const real = loadDataset();

async function connected(d: Dataset = data): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(d).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}
const text = (r: object) => (r as { content: { text: string }[] }).content[0]!.text;
const bytes = (r: object) => Buffer.byteLength(JSON.stringify(r));
const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });

test("bad input is refused at the shared boundary, with the field named, for every face", async () => {
  const bad: [Parameters<typeof buildProfile>[1], RegExp][] = [
    [{ cities: ["Turin"], salary: { amount: -85_000, currency: "EUR" } }, /salary\.amount must be a number of 0 or more; got -85000/],
    [{ cities: ["Turin"], salary: { amount: 5e9 } }, /salary\.amount looks like a typo/],
    [{ cities: ["Turin"], salaryByCity: { Dublin: { amount: -1 } } }, /salaryByCity\.dublin-ie\.amount must be/],
    [{ cities: ["Turin"], household: [{ passports: ["IT"] }, { salary: { amount: -5 } }] }, /household\[1\]\.salary\.amount must be/],
    [{ cities: ["Turin"], spending: { amount: -900 } }, /spending\.amount \(a month\) must be/],
    [{ cities: ["Turin"], weights: { nice_days: 101 } }, /weights\.nice_days must be from 0 to 100; got 101/],
    [{ cities: ["Turin"], weights: { sunshine: -5 } }, /weights\.sunshine must be from 0 to 100; got -5/],
    [{ cities: ["Turin"], weights: { sunshyne: 5 } }, /Unknown criterion "sunshyne"/],
    [{ cities: ["Turin"], only: ["sunshyne"] }, /Unknown criterion "sunshyne" in only/],
    [{ cities: ["Turin"], comfort: { min: 28, max: 20 } }, /comfort: min must be below max; got 28 to 20/],
    [{ cities: ["Turin"], comfort: { min: 20, max: 280 } }, /comfort is a range in °C/],
    [{ cities: [] }, /Give at least one city/],
    [{ cities: ["Turin"], household: [{ passports: ["IT"], regimeConfirmations: { "no-such-condition": true } }] }, /unknown condition "no-such-condition"/],
  ];
  for (const [args, msg] of bad) assert.throws(() => buildProfile(data, args), msg, JSON.stringify(args));
  assert.throws(() => netPay(data, { country: "IT", gross: -85_000 }), /gross must be a yearly salary above 0; got -85000/);
  assert.throws(() => netPay(data, { country: "IT", gross: 60_000, partner: { gross: -1 } }), /partner\.gross must be/);
  assert.throws(() => netPay(data, { country: "GB", city: "Turin", gross: 60_000 }), /Torino is in Italy, not GB/);
  assert.throws(() => netPay(data, { country: "IT", gross: 60_000, currency: "EURO" }), /Unknown currency "EURO"/);
  assert.throws(() => buildProfile(data, { cities: ["Turin"], salary: { amount: 60_000, currency: "EURO" } }), /Unknown currency "EURO"/);

  const client = await connected();
  const r = await client.callTool({ name: "compare_cities", arguments: { cities: ["Turin"], salary: { amount: -85_000, currency: "EUR" } } });
  assert.equal(r.isError, true, "a negative salary is an error, not a missing salary");
  assert.match(text(r), /salary\.amount must be a number of 0 or more/);
  const empty = await client.callTool({ name: "compare_cities", arguments: { cities: [] } });
  assert.equal(empty.isError, true);
  assert.equal(text(empty), "Give at least one city.");
  await client.close();

  // The terminal: non-zero exit, a readable line, JSON with --json, with or without the "--" escape.
  const neg = cli("net-pay", "Lisbon", "-85000", "--currency", "EUR");
  assert.equal(neg.status, 1);
  assert.match(neg.stderr, /-85000: amounts, weights and shares cannot be negative/);
  const escaped = cli("net-pay", "Lisbon", "--currency", "EUR", "--", "-85000");
  assert.equal(escaped.status, 1);
  const file = join(process.env.BORGO_HOME!, "bad-weights.json");
  writeFileSync(file, JSON.stringify({ cities: ["Lisbon", "Berlin"], weights: { nice_days: 101, sunshine: -5 } }));
  const w = cli("compare", "--args", file, "--json");
  assert.equal(w.status, 1);
  assert.match(JSON.parse(w.stdout).error, /weights\.nice_days must be from 0 to 100; got 101\. weights\.sunshine must be from 0 to 100; got -5\./);
  const rev = cli("compare", "Lisbon", "--comfort", "28-20");
  assert.equal(rev.status, 1);
  assert.match(rev.stderr, /min must be below max/);
});

test("a name two places share is an error that asks for the country; a loose reading is said out loud", () => {
  const d = fixture();
  d.cities.push({ id: "london-ca", name: "London", country: "CA", lat: 42.98, lon: -81.25 });
  d.countries.CA = { code: "CA", name: "Canada", currency: "CAD", areas: [] };
  assert.throws(() => matchCity(d, "London"), /"London" could mean London, GB \(london-gb\) or London, CA \(london-ca\)\. Add the country/);
  assert.equal(matchCity(d, "London, CA").city.id, "london-ca");
  assert.equal(matchCity(d, "london-gb").city.id, "london-gb");
  const loose = matchCity(real, "Lisboan");
  assert.equal(loose.city.id, "lisbon-pt");
  assert.match(loose.note!, /Read "Lisboan" as Lisbon, PT \(lisbon-pt\)/);
  assert.ok(buildProfile(real, { cities: ["Lisboan"] }).assumptions.some((a) => /Read "Lisboan" as Lisbon/.test(a)));
});

test("only: one line answers a one-line question without zeroing the rest by hand, and says its range", () => {
  const r = compare(real, { cities: ["Los Angeles", "Lisbon", "Dubai"], only: ["nice_days"], comfort: { min: 20, max: 28 } });
  for (const c of r.cities) assert.ok(c.lines.every((l) => (l.id === "nice_days" ? l.weight === 100 : l.weight === 0)));
  assert.equal(r.ranking[0]!.id, "los-angeles-us");
  const s = summarize(r);
  assert.match(s.lines[0]!.label, /Nice days \(20-28 °C feels-like/);
  assert.ok(r.assumptions.some((a) => /Only nice_days counts/.test(a)));
});

test("household: unknown passports and per-person regime confirmations are expressible", () => {
  const { profile, assumptions } = buildProfile(data, {
    cities: ["Turin"],
    household: [{ regimeConfirmations: { "nl-recruited-abroad": true, "nl-150km": false } }, { salary: { amount: 40_000 }, relation: "partner" }],
  });
  assert.deepEqual(profile.household.map((p) => p.citizenships), [[], []]);
  assert.deepEqual(profile.household[0]!.newcomer?.confirmed, { "nl-recruited-abroad": true, "nl-150km": false });
  assert.ok(assumptions.some((a) => /No passports given for you/.test(a)));
  const r = compare(data, { cities: ["Turin", "London"], household: [{}], dealBreakers: ["right_to_live"] });
  assert.ok(r.ranking.every((x) => x.status === "unknown"));
  assert.match(r.verdict, /No city can be said to pass every must-pass yet/);
  assert.deepEqual(r.requiredUnknowns.map((x) => x.lines), [["Everyone can move there"], ["Everyone can move there"]]);
  assert.ok(r.cities.every((c) => c.rights.every((x) => x.status === "unknown" && /Not checked/.test(x.text))));
});

test("mcp: compact by default, versioned, and small enough for a context window", async () => {
  const client = await connected(real);
  const args = { cities: ["Lisbon", "Valencia", "Berlin", "Amsterdam"], preset: "family", salary: { amount: 85_000, currency: "EUR" }, household: [{}, { salary: { amount: 40_000, currency: "EUR" }, relation: "partner" }], children: [3] };
  const s = await client.callTool({ name: "compare_cities", arguments: args });
  assert.notEqual(s.isError, true, text(s));
  const sc = s.structuredContent as { reportVersion: string; detail: string; verdict: string; nextInputs: string[]; notes: string[] };
  assert.equal(sc.reportVersion, REPORT_VERSION);
  assert.equal(sc.detail, "summary");
  assert.ok(sc.nextInputs.length && sc.notes.length && sc.verdict);
  assert.ok(bytes(s) < 20_000, `a four-city compare is ${bytes(s)} bytes`);
  const full = await client.callTool({ name: "compare_cities", arguments: { ...args, detail: "full" } });
  assert.equal((full.structuredContent as { detail: string }).detail, "full");
  assert.ok(bytes(full) > bytes(s));

  const ids = real.cities.map((c) => c.id);
  const all = await client.callTool({ name: "compare_cities", arguments: { cities: ids, only: ["nice_days"], comfort: { min: 20, max: 28 } } });
  const ac = all.structuredContent as { ranking: unknown[]; moreCities: number };
  assert.equal(ac.ranking.length, 10);
  assert.equal(ac.moreCities, ids.length - 10);
  assert.ok(bytes(all) < 30_000, `all seeds on one line is ${bytes(all)} bytes`);

  const z = await client.callTool({ name: "get_city", arguments: { city: "Zurich", passports: [["US"]], metrics: ["pm25"] } });
  const zc = z.structuredContent as { figures: unknown[]; rights: { status: string; text: string; sources: { url: string }[] }[] };
  assert.equal(zc.figures.length, 1);
  assert.equal(zc.rights[0]!.status, "no");
  assert.match(zc.rights[0]!.text, /No automatic right to live and work in Switzerland.*residence and work permit/);
  assert.ok(zc.rights[0]!.sources.some((x) => /admin\.ch/.test(x.url)), "cites the Swiss free-movement rules checked");
  assert.ok(bytes(z) < 6_000, `a rights question is ${bytes(z)} bytes`);
  await client.close();
});

test("mcp: every tool declares an output schema; search says how many match and points to fetch_city on a miss", async () => {
  const client = await connected(real);
  const { tools } = await client.listTools();
  for (const t of tools) assert.ok(t.outputSchema, `${t.name} has an output schema`);
  assert.equal(tools.find((t) => t.name === "record_observation")!.annotations?.idempotentHint, false);
  const one = await client.callTool({ name: "search_cities", arguments: { query: "", limit: 5 } });
  const oc = one.structuredContent as { total: number; hasMore: boolean; cities: unknown[] };
  assert.equal(oc.total, real.cities.length);
  assert.equal(oc.hasMore, true);
  assert.equal(oc.cities.length, 5);
  const miss = await client.callTool({ name: "search_cities", arguments: { query: "Ouagadougou" } });
  assert.equal((miss.structuredContent as { total: number }).total, 0);
  assert.match(text(miss), /call fetch_city with "Ouagadougou"/);
  const nl = await client.callTool({ name: "list_metrics_and_sources", arguments: { kind: "regimes", country: "NL" } });
  const regimes = (nl.structuredContent as { regimes: { id: string; country: string; conditions: { id: string }[] }[] }).regimes;
  assert.ok(regimes.length >= 1 && regimes.every((r) => r.country === "NL"));
  assert.ok(regimes[0]!.conditions.some((c) => c.id === "nl-recruited-abroad"));
  assert.match(text(nl), /`nl-recruited-abroad` \(you confirm\)/);
  assert.ok(bytes(nl) < 8_000);
  await client.close();
});

test("cli: compact by default with --full for everything; search reports the total", () => {
  const s = cli("compare", "Lisbon", "Berlin", "--salary", "60k EUR", "--json");
  assert.equal(s.status, 0, s.stderr);
  assert.equal(JSON.parse(s.stdout).detail, "summary");
  const f = cli("compare", "Lisbon", "Berlin", "--salary", "60k EUR", "--json", "--full");
  assert.equal(JSON.parse(f.stdout).detail, "full");
  const one = cli("compare", "Lisbon", "Berlin", "--only", "sunshine");
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /Only sunshine counts/);
  const q = JSON.parse(cli("search", "--limit", "3", "--json").stdout) as { total: number; hasMore: boolean; cities: unknown[] };
  assert.ok(q.total > 3 && q.hasMore && q.cities.length === 3);
  const r = cityReport(real, "Zurich", { detail: "summary" });
  assert.ok(r.figures.every((x) => x.value !== null || x.note), "a summary lists figures with a value; long series are counted");
});
