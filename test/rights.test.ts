// Right to live and work: several passports per person, and rights that are not citizenship (permanent residence,
// settled status, a residence or work permit, an EU Blue Card), scoped to a country or a free-movement area, with an
// optional end date. The same rules answer in the engine, the agent profile, the command line and the MCP server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadDataset, ROOT } from "../src/agent/dataset.ts";
import { buildProfile } from "../src/agent/profile.ts";
import { cityReport, compare } from "../src/agent/report.ts";
import { compareArgs, parseRight } from "../src/cli/main.ts";
import { evaluate } from "../src/core/engine.ts";
import { rightToLiveWork } from "../src/core/rights.ts";
import type { Person } from "../src/core/types.ts";
import { createServer } from "../src/mcp/server.ts";

process.env.WHERE_TO_LIVE_HOME = mkdtempSync(join(tmpdir(), "borgo-rights-test-"));
process.env.BORGO_HOME = process.env.WHERE_TO_LIVE_HOME;
const data = loadDataset();
const ON = "2026-11-14";
const right = (p: Person, cc: string) => rightToLiveWork(data, p, cc, ON);

test("several passports: any one that grants the right is enough", () => {
  const p: Person = { label: "You", citizenships: ["US", "IE"] };
  assert.equal(right(p, "US").via, "citizen");
  assert.equal(right(p, "DE").status, "yes", "the Irish passport carries EU free movement");
  assert.equal(right(p, "GB").status, "yes", "and the Common Travel Area");
  assert.equal(right(p, "JP").status, "no");
});

test("permanent residence and settled status grant the right in their country, without an end", () => {
  const p: Person = { label: "You", citizenships: ["US"], permits: [{ kind: "permanent", where: "DE" }, { kind: "settled", where: "GB" }] };
  const de = right(p, "DE");
  assert.equal(de.status, "yes");
  assert.equal(de.via, "permanent residence");
  assert.match(de.text, /Can live and work in Germany with permanent residence\./);
  assert.equal(right(p, "GB").via, "settled status");
  // Permanent residence in Germany is not a right in France: the passport decides there, as before.
  assert.equal(right(p, "FR").status, "no");
});

test("a permit with an end date counts until that day, and says so; an ended one does not, and says why", () => {
  const live: Person = { label: "Sam", citizenships: ["IN"], permits: [{ kind: "blue-card", where: "NL", until: "2027-06-30" }] };
  const nl = right(live, "NL");
  assert.equal(nl.status, "yes");
  assert.equal(nl.until, "2027-06-30");
  assert.match(nl.via, /EU Blue Card until 30 Jun 2027/);
  assert.match(nl.text, /valid until 30 Jun 2027; whether it can be renewed is not checked/);
  const ended: Person = { label: "Sam", citizenships: ["IN"], permits: [{ kind: "work", where: "NL", until: "2026-01-31" }] };
  const gone = right(ended, "NL");
  assert.equal(gone.status, "no");
  assert.match(gone.text, /a work visa there ended on 31 Jan 2026/);
  // The day it is judged on decides: the last valid day still counts.
  assert.equal(rightToLiveWork(data, live, "NL", "2027-06-30").status, "yes");
  assert.equal(rightToLiveWork(data, live, "NL", "2027-07-01").status, "no");
});

test("a permit that bars work is not a right to live and work", () => {
  const p: Person = { label: "You", citizenships: ["BR"], permits: [{ kind: "residence", where: "PT", work: false }] };
  const r = right(p, "PT");
  assert.equal(r.status, "no");
  assert.match(r.text, /a residence permit there does not allow work/);
});

test("a right held across a free-movement area covers each of its countries", () => {
  const p: Person = { label: "You", citizenships: [], permits: [{ kind: "other", where: "EEA" }] };
  for (const cc of ["DE", "IT", "NO"]) assert.equal(right(p, cc).status, "yes", cc);
  assert.match(right(p, "DE").text, /held across EU and EEA free movement/);
  // Nothing given covers Japan and no passport is known: not checked, never "needs a visa".
  const jp = right(p, "JP");
  assert.equal(jp.status, "unknown");
  assert.match(jp.text, /Not checked for Japan/);
});

test("a person with neither passports nor other rights is not checked", () => {
  assert.equal(right({ label: "You", citizenships: [] }, "DE").status, "unknown");
  assert.match(right({ label: "You", citizenships: [] }, "DE").text, /add your passports or other rights to live and work/);
});

test("the engine scores and must-passes on rights that are not citizenship", () => {
  const base = buildProfile(data, { cities: ["Berlin", "Paris", "Tokyo"], household: [{ passports: ["US"] }], dealBreakers: ["right_to_live"] }).profile;
  const without = evaluate(data, base);
  assert.equal(without.results.filter((r) => r.ruledOut.length).length, 3, "a US passport alone gives none of the three");
  const withPr = { ...base, household: [{ ...base.household[0]!, permits: [{ kind: "permanent" as const, where: "DE" }] }] };
  const e = evaluate(data, withPr);
  const berlin = e.results.find((r) => r.city.id === "berlin-de")!;
  assert.equal(berlin.ruledOut.length, 0);
  assert.equal(berlin.rights[0]!.via, "permanent residence");
  assert.equal(e.results[0]!.city.id, "berlin-de", "the one city everyone may move to ranks first");
});

test("agents pass rights per person; bad ones are refused with the field named", () => {
  const r = compare(data, { cities: ["Amsterdam", "Lisbon"], household: [{ passports: ["IN"], rights: [{ kind: "blue-card", where: "nl", until: "2030-01-01" }] }], dealBreakers: ["right_to_live"] });
  const ams = r.cities.find((x) => x.id === "amsterdam-nl")!;
  assert.equal(ams.rights[0]!.status, "yes");
  assert.match(ams.rights[0]!.via, /EU Blue Card/);
  assert.ok(r.cities.find((x) => x.id === "lisbon-pt")!.ruledOut.length, "the Blue Card is Dutch, not Portuguese");
  assert.throws(() => buildProfile(data, { cities: ["Lisbon"], household: [{ rights: [{ kind: "visa" as never, where: "PT" }] }] }), /household\[0\]\.rights\[0\]\.kind must be one of permanent, settled/);
  assert.throws(() => buildProfile(data, { cities: ["Lisbon"], household: [{ rights: [{ kind: "work", where: "Portugal" }] }] }), /rights\[0\]\.where must be a country code/);
  assert.throws(() => buildProfile(data, { cities: ["Lisbon"], household: [{ rights: [{ kind: "work", where: "PT", until: "June 2027" }] }] }), /rights\[0\]\.until must be a date/);
  const only = buildProfile(data, { cities: ["Lisbon"], household: [{ rights: [{ kind: "permanent", where: "PT" }] }] });
  assert.ok(only.assumptions.some((a) => /only the rights given are checked/.test(a)));
  const city = cityReport(data, "Berlin", { passports: [["US"]], rights: [[{ kind: "permanent", where: "DE" }]] });
  assert.equal(city.rights[0]!.via, "permanent residence");
});

test("the command line reads --right for you or another person, and refuses a malformed one", () => {
  assert.deepEqual(parseRight("DE:permanent"), { permit: { kind: "permanent", where: "DE" } });
  assert.deepEqual(parseRight("2=NL:blue-card:2027-06-30"), { who: "2", permit: { kind: "blue-card", where: "NL", until: "2027-06-30" } });
  assert.deepEqual(parseRight("Sam=PT:residence:no-work"), { who: "Sam", permit: { kind: "residence", where: "PT", work: false } });
  assert.throws(() => parseRight("DE"), /give WHERE:KIND/);
  assert.throws(() => parseRight("DE:work:soon"), /neither a date/);
  const a = compareArgs(["Berlin", "Lisbon"], { person: ["IT", "Sam=IN"], right: ["Sam=DE:blue-card:2028-01-31"] } as never);
  assert.deepEqual(a.household?.[1], { label: "Sam", passports: ["IN"], rights: [{ kind: "blue-card", where: "DE", until: "2028-01-31" }] });
  const cli = spawnSync(process.execPath, [join(ROOT, "bin/borgo.ts"), "compare", "Berlin", "Tokyo", "--person", "US", "--right", "DE:permanent", "--deal-breaker", "right_to_live", "--json"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const out = JSON.parse(cli.stdout) as { ranking: { city: string; ruledOut?: unknown }[] };
  assert.match(JSON.stringify(out), /permanent residence/);
});

test("the MCP server takes rights in compare_cities and get_city", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(data).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const r = await client.callTool({ name: "compare_cities", arguments: { cities: ["Berlin", "Tokyo"], household: [{ passports: ["US"], rights: [{ kind: "permanent", where: "DE" }] }], dealBreakers: ["right_to_live"] } });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  assert.match(JSON.stringify(r.structuredContent), /permanent residence/);
  const bad = await client.callTool({ name: "compare_cities", arguments: { cities: ["Berlin"], household: [{ rights: [{ kind: "passport", where: "DE" }] }] } });
  assert.equal(bad.isError, true);
  const g = await client.callTool({ name: "get_city", arguments: { city: "Amsterdam", passports: [["IN"]], rights: [[{ kind: "blue-card", where: "NL", until: "2030-01-01" }]] } });
  assert.notEqual(g.isError, true, JSON.stringify(g.content));
  assert.match(JSON.stringify(g.structuredContent), /EU Blue Card until 1 Jan 2030/);
  await client.close();
});
