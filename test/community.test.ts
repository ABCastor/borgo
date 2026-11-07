// Proposals (CONTRIBUTING.md): one shape for every face, the checks the workflow runs on an issue, the prefilled link,
// the change a valid data proposal makes, the facts due for review, and the agent faces, which post nothing without
// the person's agreement to that exact proposal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { proposeChange, type ProposeInput } from "../src/community/agent.ts";
import { changeFor, setString, type CorrectionsFile } from "../src/community/apply.ts";
import { checkFull, checkIssueBody } from "../src/community/check.ts";
import { checkCitations, nodeHttp, plainText, privateAddress, type Http, type Page } from "../src/community/net.ts";
import { correctionUrl } from "../src/community/prefill.ts";
import { checkProposal, CORRECTIONS_FILE, FIELDS, lockedFile, fingerprint, fromFields, isProposalBody, issueBody, issueUrl, MAX_URL, parseIssueBody, toFields, type Proposal } from "../src/community/proposal.ts";
import { repoView } from "../src/community/repo.ts";
import { inert, verdictMarkdown } from "../src/community/report.ts";
import { curatedFacts, staleFacts } from "../src/community/stale.ts";
import { loadDataset, ROOT } from "../src/agent/dataset.ts";
import { createServer } from "../src/mcp/server.ts";
import { formYaml } from "../scripts/proposals/form.ts";

process.env.BORGO_HOME = mkdtempSync(join(tmpdir(), "borgo-community-test-"));
const repo = repoView();
const fixture = (name: string) => readFileSync(join(ROOT, "test/fixtures/proposals", name), "utf8");

const ONS = "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/november2026";
const NY = "https://www.nysenate.gov/legislation/laws/PBH/2599-BB";
const filler = "<p>" + "Official statistics text. ".repeat(100) + "</p>";
/** A recorded web: each address answers as listed; anything else is not there. */
function web(pages: Record<string, Partial<Page>>, asked: string[] = []): Http {
  return async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) return { status: 404, type: "text/html", text: "not found", url };
    return { status: 200, type: "text/html", text: "", url, ...p };
  };
}
const goodWeb = (asked?: string[]) =>
  web({
    [ONS]: { text: `<html><body>${filler}<p>Average private rents in London rose to &pound;1,790 per month in October&nbsp;2026.</p></body></html>` },
    [NY]: { text: `<html><body>${filler}<p>§ 2599-bb. Abortion. 1. A health care practitioner ... may perform an abortion when, according to the practitioner's reasonable and good faith professional judgment based on the facts of the patient's case: the patient is within twenty-four weeks from the commencement of pregnancy, or there is an absence of fetal viability.</p></body></html>` },
    "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest": { text: filler },
  }, asked);

const checkProposalOffline = (p: Proposal) => checkProposal(p, repo);
const sample = (): Proposal => fromFields(parseIssueBody(fixture("valid-rent.md"))).proposal!;

test("a proposal survives the round trip through the form: fields, issue body, parse", () => {
  const p = sample();
  assert.equal(p.kind, "correction");
  assert.deepEqual(p.target, { city: "london-gb", metric: "rent_1bed", source: "ons-pipr" });
  assert.equal(p.citations[0]!.primary, true);
  assert.equal(p.licence, "CC-BY-4.0");
  const again = fromFields(parseIssueBody(issueBody(p)));
  assert.deepEqual(again.problems, []);
  assert.deepEqual(again.proposal, p);
  // An agent's proposal keeps its name and operator; leads stay leads.
  const agent: Proposal = { ...p, proposer: { kind: "agent", agent: "watcher@0.3", operator: "Borgo maintainers" }, citations: [...p.citations, { url: "https://news.example.org/rents", type: "news", publisher: "", title: "", accessed: "2026-11-05", primary: false }] };
  assert.deepEqual(fromFields(parseIssueBody(issueBody(agent))).proposal, agent);
  assert.ok(isProposalBody(issueBody(p)));
  assert.ok(!isProposalBody("### Something else\n\nhello"));
  assert.ok(!isProposalBody(null));
});

test("the issue form is generated from the same fields, and is up to date", () => {
  const yaml = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/proposal.yml"), "utf8");
  assert.equal(yaml, formYaml(), "run node scripts/proposals/form.ts");
  for (const f of FIELDS) assert.match(yaml, new RegExp(`id: ${f.id}\\n`));
  // Only text fields can be prefilled from a link, so every field a link sets is an input or a textarea.
  for (const id of ["kind", "city", "metric", "source", "current", "unit", "period", "level"]) assert.notEqual(FIELDS.find((f) => f.id === id)!.type, "checkboxes");
});

test("a valid figure correction passes, opens a pull request, and only one reviewer is needed", async () => {
  const asked: string[] = [];
  const { proposal, verdict } = await checkIssueBody(fixture("valid-rent.md"), { repo, http: goodWeb(asked) });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.route, "pr");
  assert.equal(verdict.locked, false);
  assert.deepEqual(verdict.labels, ["proposal", "valid", "data"]);
  assert.deepEqual(asked, [ONS]);
  // The change it makes: one entry in data/corrections.json, with its citation and a review date.
  const change = changeFor(proposal!, repo, { issue: 42, on: "2026-11-05", current: null })!;
  assert.equal(change.path, CORRECTIONS_FILE);
  const file = JSON.parse(change.content) as CorrectionsFile;
  assert.equal(file.corrections.length, 1);
  const c = file.corrections[0]!;
  assert.deepEqual([c.city, c.metric, c.source, c.value, c.period, c.level, c.url], ["london-gb", "rent_1bed", "ons-pipr", 1790, "2026-10", "region", ONS]);
  assert.equal(c.correction.issue, 42);
  assert.equal(c.reviewBy, "2027-02-03"); // ONS releases monthly: 90 days
  // A second proposal for the same figure replaces the first rather than stacking.
  const next = changeFor({ ...proposal!, proposed: "1795" }, repo, { issue: 43, on: "2026-11-06", current: change.content })!;
  const after = (JSON.parse(next.content) as CorrectionsFile).corrections;
  assert.equal(after.length, 1);
  assert.equal(after[0]!.value, 1795);
});

test("a malformed proposal is refused with a reason for each fault, and its text stays inert", async () => {
  const asked: string[] = [];
  const { proposal, verdict } = await checkIssueBody(fixture("malformed.md"), { repo, http: web({}, asked) });
  // An unknown kind is reported, and the rest is still checked as the kind the target implies.
  assert.equal(proposal!.kind, "correction");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.route, "issue");
  assert.deepEqual(verdict.labels, ["proposal", "needs changes", "data"]);
  const all = verdict.problems.join("\n");
  for (const want of [/There is no metric "rent_1bedroom"/, /"ons\.gov\.uk rents table" is not a web address/, /Cite the official text itself/, /Kind of change "fix" is not one of/, /Level "borough" is not one of/, /Period "last month" is not/, /Say what the source is/, /Read on "5 November" is not a date/, /Tick the licence box/, /Name the source's publisher/]) assert.match(all, want);
  assert.deepEqual(asked, [], "a malformed proposal opens no page");
  // The comment carries no live markup, mention or image from the issue.
  const md = verdictMarkdown({ ...verdict, problems: [...verdict.problems, `Note was ${"<img src=x onerror=alert(1)> @everyone ![x](https://example.com/t.png)"}`] }, { forGitHub: true });
  assert.doesNotMatch(md, /<img|@everyone|!\[x\]\(/);
  assert.match(md, /^<!-- borgo-proposal-check -->/);
});

test("a figure with the wrong unit, metric or shape is refused", async () => {
  const p = sample();
  const v = (q: Proposal) => checkFull(q, { repo, offline: true });
  assert.match((await v({ ...p, unit: "EUR/month" })).problems.join(), /rent_1bed is given in GBP\/month, not "EUR\/month"/);
  assert.match((await v({ ...p, proposed: "about 1800" })).problems.join(), /rent_1bed takes one number/);
  assert.match((await v({ ...p, proposed: "-5" })).problems.join(), /rent_1bed runs from 0/);
  assert.match((await v({ ...p, target: { city: "london-gb", metric: "rent_2bed", source: "ons-pipr" } })).problems.join(), /There is no metric "rent_2bed"/);
  assert.match((await v({ ...p, target: { city: "london-gb", metric: "pm25", source: "ons-pipr" } })).problems.join(), /ons-pipr does not measure pm25/);
  assert.match((await v({ ...p, target: { city: "london-gb", metric: "rent_1bed", source: "nowhere" } })).problems.join(), /There is no registry source "nowhere"/);
  // A monthly figure takes 12 numbers.
  assert.match((await v({ ...p, target: { city: "london-gb", metric: "temp_high", source: "open-meteo-era5" }, proposed: "8 9 12", unit: "°C" })).problems.join(), /temp_high takes 12 numbers/);
  // A city with no committed figures is read live: the proposal stays an issue, with the reason.
  const live = await v({ ...p, target: { city: "palermo-it", metric: "rent_1bed", source: "ons-pipr" }, unit: "EUR/month" });
  assert.equal(live.route, "issue");
  assert.match(live.warnings.join(), /palermo-it has no committed figures/);
});

test("a link-only source can never be cited, and is never fetched", async () => {
  const asked: string[] = [];
  const { verdict } = await checkIssueBody(fixture("link-only.md"), { repo, http: goodWeb(asked) });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(), /numbeo\.com is a link-only source \(numbeo\): its terms forbid copying/);
  assert.deepEqual(asked, [], "Numbeo is not opened, even to check the citation");
  // Citing the link-only source's figure as the target source is refused too, and so is a lead on it.
  const p = sample();
  assert.match((await checkFull({ ...p, target: { city: "london-gb", metric: "rent_1bed", source: "numbeo" } }, { repo, offline: true })).problems.join(), /Numbeo[^:]* is a link-only source/);
  assert.match((await checkFull({ ...p, citations: [...p.citations, { url: "https://weatherspark.com/y/45062", type: "news", publisher: "", title: "", accessed: "2026-11-05", primary: false }] }, { repo, offline: true })).problems.join(), /weatherspark\.com is a link-only source/);
});

test("a rule change without its legal text is refused; with the statute it passes, locked, and stays an issue", async () => {
  const bad = await checkIssueBody(fixture("rule-without-primary.md"), { repo, http: web({}) });
  assert.equal(bad.verdict.ok, false);
  assert.match(bad.verdict.problems.join("\n"), /Cite the official text itself/);
  assert.match(bad.verdict.problems.join("\n"), /A rule changes only by a legal text: cite the statute or the official gazette/);
  assert.ok(bad.verdict.labels.includes("rule") && bad.verdict.labels.includes("locked"));
  // An official page that explains the rule is primary, but a rule still needs the law itself.
  const page = { ...bad.proposal!, citations: [{ ...bad.proposal!.citations[0]!, type: "official-page" as const, primary: true, url: "https://www.agenziaentrate.gov.it/portale/irpef" }] };
  assert.match((await checkFull(page, { repo, offline: true })).problems.join(), /A rule changes only by a legal text/);
  // A correction to a figure that is a hand-encoded law is a rule change too.
  const law = { ...sample(), target: { city: "london-gb", metric: "abortion_law", source: "abortion-law" }, proposed: "4", unit: undefined };
  const lv = await checkFull(law, { repo, offline: true });
  assert.ok(lv.locked);
  assert.match(lv.problems.join(), /A rule changes only by a legal text/);

  const good = await checkIssueBody(fixture("valid-rule.md"), { repo, http: goodWeb() });
  assert.deepEqual(good.verdict.problems, []);
  assert.equal(good.verdict.route, "issue");
  assert.equal(good.verdict.locked, true);
  assert.deepEqual(good.verdict.labels, ["proposal", "valid", "rule", "locked"]);
  assert.match(good.verdict.next, /two independent reviews/);
  assert.equal(changeFor(good.proposal!, repo, { issue: 1, on: "2026-11-05", current: null }), null, "a rule is never changed by the workflow");
  // The path must name something in the file.
  assert.match((await checkFull({ ...good.proposal!, target: { file: "src/fetch/rights-law.ts", path: "NO_SUCH_TABLE.US-NY" } }, { repo, offline: true })).problems.join(), /does not appear in src\/fetch\/rights-law\.ts/);
  assert.match((await checkFull({ ...good.proposal!, target: { file: "../../etc/passwd", path: "root" } }, { repo, offline: true })).problems.join(), /must be a path inside the repository/);
  assert.match((await checkFull({ ...good.proposal!, target: { file: "node_modules/zod/package.json", path: "name" } }, { repo, offline: true })).problems.join(), /There is no file/);
});

test("a registry address fix opens a pull request that changes only that address", async () => {
  const { proposal, verdict } = await checkIssueBody(fixture("valid-link.md"), { repo, http: goodWeb() });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.route, "pr");
  const before = repo.read("registry/ons-pipr.json")!;
  const change = changeFor(proposal!, repo, { issue: 7, on: "2026-11-05", current: before })!;
  assert.equal(change.path, "registry/ons-pipr.json");
  const diff = change.content.split("\n").filter((l, i) => l !== before.split("\n")[i]);
  assert.equal(diff.length, 1);
  assert.match(diff[0]!, /"homepage": "https:\/\/www\.ons\.gov\.uk\/economy\/inflationandpriceindices\/bulletins\/privaterentandhousepricesuk\/latest"/);
  assert.equal(setString('{"a": {"b": 1}}', "a.b", "x"), null, "only a string is replaced");
});

test("the network check: pages that are missing fail, refusals go to the reviewer, the quote must be on the page", async () => {
  const p = sample();
  assert.deepEqual(await checkCitations(p, goodWeb()), { problems: [], warnings: [] });
  assert.match((await checkCitations(p, web({}))).problems.join(), /answers 404: the page is not there/);
  assert.match((await checkCitations(p, web({ [ONS]: { status: 403 } }))).warnings.join(), /answered 403 to an automated check; the reviewer opens it in a browser/);
  assert.match((await checkCitations(p, web({ [ONS]: { text: `<p>${filler}Rents rose.</p>` } }))).problems.join(), /The quote is not on/);
  assert.match((await checkCitations(p, web({ [ONS]: { type: "application/pdf", text: "" } }))).warnings.join(), /cannot be checked automatically/);
  assert.match((await checkCitations(p, async () => { throw new Error("getaddrinfo ENOTFOUND"); })).problems.join(), /could not be read: getaddrinfo ENOTFOUND/);
  assert.equal(plainText("Rents &amp; prices&nbsp;rose  to <b>&pound;1,790</b>"), "rents & prices rose to £1,790");
  // Addresses inside a private network are never opened.
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "172.20.0.1", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(privateAddress(ip), ip);
  for (const ip of ["151.101.1.69", "2606:4700::1111"]) assert.ok(!privateAddress(ip), ip);
  for (const url of ["http://127.0.0.1/", "http://localhost:8080/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "https://example.org:8443/", "https://user:pw@example.org/"]) await assert.rejects(nodeHttp(url), Error, url);
});

test("the prefilled link fills the form's fields and stays under GitHub's limit", () => {
  const data = loadDataset();
  const city = data.cities.find((c) => c.id === "london-gb")!;
  const o = data.observations["london-gb"]!.find((x) => x.metric === "rent_1bed")!;
  const url = new URL(correctionUrl(city, data.metrics.rent_1bed!, o, "GBP"));
  assert.equal(url.origin + url.pathname, "https://github.com/ABCastor/borgo/issues/new");
  const q = Object.fromEntries(url.searchParams);
  assert.equal(q.template, "proposal.yml");
  assert.deepEqual([q.kind, q.city, q.metric, q.source, q.unit, q.period, q.level], ["correction", "london-gb", "rent_1bed", o.source, "GBP/month", o.period, o.level]);
  assert.match(q.current!, new RegExp(`^${o.value} `));
  assert.match(q.title!, /^Correction: Rent, one bedroom, London$/);
  assert.equal(q.labels, undefined, "a labels parameter needs triage rights and would 404 for everyone else");
  assert.equal(q.grant, undefined, "the licence box is the person's to tick");
  // What the person adds on the form (the new value, the official source, the licence box) makes it a valid proposal.
  const filled = fromFields({ ...q, proposed: "1790", period: "2026-10", citation_url: ONS, citation_type: "official-table", citation_publisher: "Office for National Statistics", citation_title: "Private rent and house prices, UK", citation_accessed: "2026-11-05", grant: "yes" });
  assert.deepEqual(filled.problems, []);
  const fv = checkProposalOffline(filled.proposal!);
  assert.deepEqual(fv.problems, []);
  assert.equal(fv.route, "pr");
  // A monthly or hourly figure, or a very long quote, is shortened to fit.
  const hourly = data.observations["london-gb"]!.find((x) => x.metric === "temp_hourly");
  if (hourly) assert.ok(correctionUrl(city, data.metrics.temp_hourly!, hourly, "GBP").length <= MAX_URL);
  const long = issueUrl({ ...toFields(sample()), citation_quote: "é".repeat(5000), note: "x ".repeat(4000) }, "t");
  assert.ok(long.length <= MAX_URL, String(long.length));
  assert.equal(new URL(long).searchParams.get("citation_url"), ONS, "the fields that matter survive");
});

test("curated facts carry review dates, and list_stale finds the ones due", () => {
  const facts = curatedFacts();
  const by = new Map(facts.map((f) => [f.id, f]));
  assert.equal(by.get("tax:GB")!.reviewBy, "2027-04-06");
  assert.equal(by.get("tax:AU")!.reviewBy, "2027-07-01");
  assert.equal(by.get("tax:IT")!.reviewBy, "2027-01-01");
  assert.equal(by.get("law:abortion:IT")!.reviewBy, "2027-11-05", "checked on 2026-11-05: due a year later");
  assert.equal(by.get("politics:SE")!.reviewBy, "2030-09-13");
  assert.equal(by.get("leave:IT")!.reviewBy, "2027-11-04");
  const due = staleFacts(facts, { asOf: "2026-11-05" });
  assert.ok(due.total > 0);
  assert.ok(due.facts.every((f) => f.reviewBy <= "2026-11-05"));
  assert.ok(due.facts.some((f) => f.id === "law:abortion:US-MA" && /never compared with its source/.test(f.why)));
  assert.ok(staleFacts(facts, { asOf: "2026-11-05", within: 60 }).facts.some((f) => f.id === "tax:IT"));
  assert.equal(staleFacts(facts, { asOf: "2026-11-05", kind: "tax" }).total, 0);
  assert.ok(staleFacts(facts, { asOf: "2026-11-05", country: "us" }).facts.every((f) => f.country === "US"));
  // Every fact's proposal target names something its file holds, so a proposal built from it passes that check.
  for (const f of facts.filter((x) => "file" in x.propose.target)) {
    const t = f.propose.target as { file: string; path: string };
    assert.ok(repo.read(t.file)?.includes(t.path.split(".")[0]!), `${f.id}: ${t.file} ${t.path}`);
  }
});

const ruleInput: ProposeInput = {
  kind: "rule-change",
  file: "src/fetch/rights-law.ts",
  path: "ABORTION.US-NY",
  current: "4: on request to 24 weeks",
  proposed: "Unchanged (4); checked against the statute on 2026-11-05",
  citation: { url: NY, type: "statute", publisher: "New York State Senate", title: "Public Health Law s. 2599-BB", accessed: "2026-11-05", quote: "the patient is within twenty-four weeks from the commencement of pregnancy" },
  agent: "test-agent@1.0",
  operator: "Borgo tests",
};

test("propose_change posts nothing without the person's agreement to that exact proposal", async () => {
  const posts: unknown[] = [];
  const poster = (o: unknown) => (posts.push(o), { url: "https://github.com/ABCastor/borgo/issues/999" });
  const deps = { repo, http: goodWeb(), poster };
  const first = await proposeChange(ruleInput, deps);
  assert.equal(first.valid, true);
  assert.equal(first.posted, null);
  assert.equal(posts.length, 0);
  assert.match(first.issueUrl, /^https:\/\/github\.com\/ABCastor\/borgo\/issues\/new\?template=proposal\.yml&/);
  assert.equal(first.confirm, fingerprint(first.proposal));
  // A token for another proposal, or none that matches, posts nothing.
  const wrong = await proposeChange({ ...ruleInput, post: { confirm: "0000000000000000" } }, deps);
  assert.equal(wrong.posted, null);
  assert.match(wrong.notPosted!, /does not match this proposal/);
  const changed = await proposeChange({ ...ruleInput, proposed: "Something else", post: { confirm: first.confirm } }, deps);
  assert.equal(changed.posted, null);
  assert.equal(posts.length, 0);
  // An invalid proposal is never posted, even with its own token.
  const bad = await proposeChange({ ...ruleInput, citation: { ...ruleInput.citation, type: "news" } }, deps);
  const badPost = await proposeChange({ ...ruleInput, citation: { ...ruleInput.citation, type: "news" }, post: { confirm: bad.confirm } }, deps);
  assert.equal(badPost.posted, null);
  assert.match(badPost.notPosted!, /does not pass the checks/);
  // The agreed proposal is posted once, in the form's format, so the workflow checks it too.
  const ok = await proposeChange({ ...ruleInput, post: { confirm: first.confirm } }, deps);
  assert.deepEqual(ok.posted, { url: "https://github.com/ABCastor/borgo/issues/999" });
  assert.equal(posts.length, 1);
  const body = (posts[0] as { body: string }).body;
  assert.ok(isProposalBody(body));
  assert.deepEqual(fromFields(parseIssueBody(body)).proposal, first.proposal);
  // An agent names itself and its operator.
  const anon = await proposeChange({ ...ruleInput, agent: "nameless", operator: "" }, deps);
  assert.match(anon.verdict.problems.join(), /name@1\.0[\s\S]*operator/);
});

test("the MCP server: list_stale and propose_change, from the tool descriptions alone", async () => {
  const posts: unknown[] = [];
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(loadDataset(), { http: goodWeb(), poster: (o) => (posts.push(o), { url: "x" }), today: () => "2026-11-05" }).connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("list_stale") && tools.includes("propose_change"));
  const stale = (await client.callTool({ name: "list_stale", arguments: { kind: "law", country: "US" } })) as unknown as { structuredContent: { facts: { id: string; propose: { target: { file: string; path: string } } }[] } };
  const ny = stale.structuredContent.facts.find((f) => f.id === "law:abortion:US-MA")!;
  assert.deepEqual(ny.propose.target, { file: "src/fetch/rights-law.ts", path: "ABORTION.US-MA" });
  const r = (await client.callTool({ name: "propose_change", arguments: { ...ruleInput, ...ny.propose.target } })) as unknown as { content: { text: string }[]; structuredContent: { valid: boolean; issueUrl: string; confirm: string; posted: unknown } };
  assert.equal(r.structuredContent.valid, true);
  assert.equal(r.structuredContent.posted, null);
  assert.match(r.content[0]!.text, /only after they say yes/);
  assert.equal(posts.length, 0);
});

test("the CLI: stale and propose, with the prefilled link and an exit code that says whether it passes", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, "bin/borgo.ts"), ...args], { cwd: ROOT, encoding: "utf8" });
  const s = cli("stale", "--as-of", "2026-11-05", "--kind", "law", "--json");
  assert.equal(s.status, 0, s.stderr);
  assert.ok(JSON.parse(s.stdout).facts.length > 0);
  const base = ["propose", "--kind", "correction", "--city", "london-gb", "--metric", "rent_1bed", "--source", "ons-pipr", "--proposed", "1790", "--unit", "GBP/month", "--period", "2026-10", "--level", "region", "--type", "official-table", "--publisher", "Office for National Statistics", "--title", "Private rent and house prices, UK", "--accessed", "2026-11-05", "--offline", "--json"];
  const ok = cli(...base, "--url", ONS);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const r = JSON.parse(ok.stdout);
  assert.equal(r.valid, true);
  assert.equal(r.route, "pr");
  assert.match(r.issueUrl, /template=proposal\.yml/);
  const lo = cli(...base, "--url", "https://www.numbeo.com/cost-of-living/in/London");
  assert.equal(lo.status, 1);
  assert.match(JSON.parse(lo.stdout).problems.join(), /link-only source/);
});

test("CODEOWNERS lists every locked file, and only locked files are listed as locked", () => {
  const lines = readFileSync(join(ROOT, ".github/CODEOWNERS"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("# Locked:"));
  const end = lines.findIndex((l, i) => i > start && l.trim() === "");
  const locked = lines.slice(start + 1, end).map((l) => l.trim().split(/\s+/));
  for (const [path, ...owners] of locked) {
    assert.ok(owners.length >= 1, `${path} needs an owner`);
    const file = path!.replace(/^\//, "");
    assert.ok(lockedFile(file.endsWith("/") ? `${file}x.ts` : file), `${path} is locked in the checks too`);
  }
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const f of tracked.filter(lockedFile)) assert.ok(locked.some(([p]) => (p!.endsWith("/") ? f.startsWith(p!.slice(1)) : f === p!.slice(1))), `${f} is locked but has no CODEOWNERS line`);
});

/** Runs a workflow script against a recorded GitHub API, as the workflow would, and returns every call it made. */
async function runWorkflowScript(script: string, fixtureName: string, issueLabels: string[] = ["proposal"]): Promise<{ code: number; calls: { method: string; path: string; body: any }[]; out: string; output: string }> {
  const calls: { method: string; path: string; body: any }[] = [];
  const server = httpServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url ?? "";
      calls.push({ method: req.method ?? "", path, body: raw ? JSON.parse(raw) : null });
      const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
      if (req.method === "GET" && /\/comments/.test(path)) return send(200, []);
      if (req.method === "GET" && path.endsWith("/git/ref/heads/main")) return send(200, { object: { sha: "base123" } });
      if (req.method === "GET" && /\/git\/ref\/heads\/proposal/.test(path)) return send(404, { message: "Not Found" });
      if (req.method === "GET" && /\/contents\//.test(path)) return send(200, { sha: "file456" });
      if (req.method === "GET" && /\/pulls\?/.test(path)) return send(200, []);
      if (req.method === "POST" && path.endsWith("/pulls")) return send(201, { number: 5, html_url: "https://github.com/ABCastor/borgo/pull/5" });
      return send(req.method === "POST" ? 201 : 200, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "borgo-workflow-"));
  const event = join(dir, "event.json");
  const output = join(dir, "output");
  writeFileSync(output, "");
  writeFileSync(event, JSON.stringify({ issue: { number: 1, state: "open", body: fixture(fixtureName), labels: issueLabels.map((name) => ({ name })) }, repository: { full_name: "ABCastor/borgo", default_branch: "main" } }));
  const child = spawn(process.execPath, [join(ROOT, script)], { cwd: ROOT, env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_API_URL: `http://127.0.0.1:${port}`, ["GITHUB_" + "TOKEN"]: "test" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise<number>((r) => child.on("close", (c) => r(c ?? 1)));
  server.close();
  return { code, calls, out, output: readFileSync(output, "utf8") };
}

test("the workflow scripts: a refused proposal is labelled and commented once; a valid data proposal becomes a pull request", async () => {
  // The link-only and malformed fixtures open no page, so this runs without the network.
  const refused = await runWorkflowScript("scripts/proposals/check-issue.ts", "link-only.md", ["proposal", "valid"]);
  assert.equal(refused.code, 0, refused.out);
  assert.equal(refused.output, "route=none\n");
  const labelCalls = refused.calls.filter((c) => c.path.includes("/labels"));
  assert.deepEqual(labelCalls.map((c) => `${c.method} ${decodeURIComponent(c.path)}`), ["DELETE /repos/ABCastor/borgo/issues/1/labels/valid", "POST /repos/ABCastor/borgo/issues/1/labels"]);
  assert.deepEqual(labelCalls[1]!.body, { labels: ["needs changes", "data"] });
  const comment = refused.calls.find((c) => c.method === "POST" && c.path.endsWith("/issues/1/comments"))!;
  assert.match(comment.body.body, /^<!-- borgo-proposal-check -->[\s\S]*numbeo\.com is a link-only source/);
  // The issue's own text never reaches the comment unescaped.
  const bad = await runWorkflowScript("scripts/proposals/check-issue.ts", "malformed.md");
  const c2 = bad.calls.find((c) => c.method === "POST" && c.path.endsWith("/comments"))!;
  assert.doesNotMatch(c2.body.body, /<img|@everyone/);

  const pr = await runWorkflowScript("scripts/proposals/open-pr.ts", "valid-link.md");
  assert.equal(pr.code, 0, pr.out);
  const seq = pr.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`);
  assert.deepEqual(seq, [
    "GET /repos/ABCastor/borgo/git/ref/heads/main",
    "GET /repos/ABCastor/borgo/git/ref/heads/proposal/issue-1",
    "POST /repos/ABCastor/borgo/git/refs",
    "GET /repos/ABCastor/borgo/contents/registry/ons-pipr.json",
    "PUT /repos/ABCastor/borgo/contents/registry/ons-pipr.json",
    "GET /repos/ABCastor/borgo/pulls",
    "POST /repos/ABCastor/borgo/pulls",
  ]);
  const put = pr.calls.find((c) => c.method === "PUT")!;
  assert.equal(put.body.branch, "proposal/issue-1");
  assert.equal(put.body.sha, "file456");
  assert.match(Buffer.from(put.body.content, "base64").toString("utf8"), /"homepage": "https:\/\/www\.ons\.gov\.uk\/economy\/inflationandpriceindices\/bulletins\/privaterentandhousepricesuk\/latest"/);
  const open = pr.calls.find((c) => c.method === "POST" && c.path.endsWith("/pulls"))!;
  assert.equal(open.body.head, "proposal/issue-1");
  assert.match(open.body.body, /Proposed in #1/);
  // A rule is never turned into a pull request, even if the job were started for it.
  const rule = await runWorkflowScript("scripts/proposals/open-pr.ts", "valid-rule.md");
  assert.equal(rule.code, 1);
  assert.deepEqual(rule.calls, []);
});

test("inert: issue text cannot mention, embed or break out of a comment", () => {
  assert.equal(inert("<script>@team ![a](b) | x\ny"), "&lt;script&gt;@\u200bteam !\u200b[a]\u200b(b) \\| x y");
});
