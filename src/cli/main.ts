// The terminal face of the same engine. Markdown by default, --json for scripts and agents.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_COMFORT } from "../core/criteria.ts";
import type { HousingSize, TaxTweak } from "../core/types.ts";
import { searchCities } from "../agent/cities.ts";
import { chartInput, compareSvg } from "../agent/chart.ts";
import { loadDataset, ROOT } from "../agent/dataset.ts";
import { catalogueMarkdown, cataloguePartMarkdown, cityMarkdown, compareMarkdown, netPayMarkdown, summaryMarkdown } from "../agent/markdown.ts";
import { methodology } from "../agent/methodology.ts";
import type { Money, PeriodAmount, QueryArgs } from "../agent/profile.ts";
import { CATALOGUE_KINDS, catalogue, cataloguePart, cityReport, compare, netPay, REPORT_VERSION, summarize, summaryWhy, type CatalogueKind } from "../agent/report.ts";
import { fetchPlace, placeFetchMarkdown, placeFetchSummary } from "../agent/fetch-place.ts";
import { listSources, sourcesMarkdown } from "../agent/sources.ts";
import { loadRegistry } from "../registry/load.ts";

const HELP = `borgo: compare cities to live in on open, sourced data, weighted by what you value.

Start here
  borgo compare Lisbon Berlin --salary "60k EUR"
      rank two cities on the balanced weights, with take-home pay and what to add next

Usage
  borgo compare <city> <city> ... [options]     rank cities for you (compact; --full for every line and tax line)
  borgo city <city> [--person US] [--metric rent_1bed,pm25] [--full]
                                                a city's figures with sources, and who may live there
  borgo net-pay <country|city> <gross> [--currency GBP] [--region US-CA] [--taxable-share 0.5] [--flat-rate 0.24]
        [--age 30] [--children 2,5] [--pension 5%] [--regime it-impatriati] [--partner 40k] [--married]
  borgo fetch <place> [--only a,b] [--refresh] [--full]
                                                fetch any place ("Palermo, IT") from the sources, into your cache
  borgo search [query] [--country IT] [--limit 20]
                                                find city ids (the snapshot and your fetched places)
  borgo sources [--metric pm25] [--country IE]  the source registry: what each source measures, terms, how it is fetched
  borgo catalogue [--kind regimes] [--country NL]
                                                criteria, metrics, sources, tax models, regimes, presets
  borgo methodology                             how scores and money are computed
  borgo data build                              validate data/ and build public/data/dataset.json
  borgo data refresh [source]                   re-fetch one source (or all), then build
  borgo mcp                                     run the MCP server on stdio

Compare options
  --preset balanced|founder|family|saver   --weight clean_air=20 (repeatable, 0-100)
  --only nice_days (score only these lines, comma-separated; every other line counts 0)
  --full (every line, tax line and source)   --limit 10 (cities described in the compact answer)
  --person IT,US (passports, one per person moving; leave out what you do not know)
  --salary "70k EUR"   --salary-in "London=85000 GBP" (repeatable)
  --pension 5% (of your gross: tax relief where the plan is modelled, see "catalogue --kind pensions";
      elsewhere not modelled, counted as saving)   --age 34   --children 2,5 (ages)
  --partner "40k EUR" (a second person's pay; their passports from a second --person, else not checked)
  --partner-in "London=50000 GBP" (repeatable)   --partner-age 33
  --married (the second person is your spouse: joint filing where the country has it)
  --regime IT:it-impatriati (yours, repeatable; ids in "catalogue --kind regimes")
  --partner-regime NL:nl-expat (the second person's own, repeatable, checked against their own facts)
  --spending "1200 EUR" --home Turin (a month, on everything except housing, childcare and health)
  --housing 1bed|3bed  --display EUR   --savings 20000
  --health-premium "Zurich=450/month" (repeatable: the household's premium bought outside pay, local currency;
      say /month or /year, a year is counted as a twelfth a month)
  --childcare-cost "Zurich=1800/month" (repeatable: what you pay for childcare there, after support; /month or /year)
  --no-paid-childcare (the children under 6 are not in paid childcare: no childcare cost is counted)
  --comfort 18-30 (nice days: daytime feels-like, °C)   --comfort-air (the range is air temperature)
  --relative   --missing-skip   --missing-worst   --deal-breaker right_to_live (must pass; repeatable)
  --stance politics=3.5 (where you stand: politics 0 left to 10 right; abortion 0-4 and couples_law 0-3
      by step, or a step's words such as couples_law=marriage; repeatable, and only what you say)
  --override "Dublin:rent_1bed=2100" (repeatable)  --line "Family nearby:Turin=5,Dublin=2" (repeatable)
  --tax-tweak "IT:taxableShare=0.5" (repeatable)   --args profile.json (QueryArgs JSON; flags apply on top)
  --svg chart.svg   write the comparison chart

Advanced
  borgo compare Turin London Dublin "San Francisco" --person IT --person Partner=IT,US \\
    --salary "70k EUR" --salary-in "London=85000 GBP" --partner "40k EUR" --married --age 34 \\
    --children 2,5 --spending "1200 EUR" --home Turin --preset founder --deal-breaker right_to_live

Every command takes --json for machine-readable output; errors then print {"error": "..."} and every error exits 1.
Fetched places live in your cache ($BORGO_HOME, default ~/.cache/borgo) and every other command sees them.
The command also answers to where-to-live.`;

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  preset: { type: "string" },
  weight: { type: "string", multiple: true },
  person: { type: "string", multiple: true },
  salary: { type: "string" },
  "salary-in": { type: "string", multiple: true },
  currency: { type: "string" },
  display: { type: "string" },
  housing: { type: "string" },
  spending: { type: "string" },
  home: { type: "string" },
  savings: { type: "string" },
  comfort: { type: "string" },
  "comfort-air": { type: "boolean" },
  relative: { type: "boolean" },
  "missing-worst": { type: "boolean" },
  "missing-skip": { type: "boolean" },
  override: { type: "string", multiple: true },
  "deal-breaker": { type: "string", multiple: true },
  stance: { type: "string", multiple: true },
  line: { type: "string", multiple: true },
  "tax-tweak": { type: "string", multiple: true },
  args: { type: "string" },
  svg: { type: "string" },
  country: { type: "string" },
  region: { type: "string" },
  "taxable-share": { type: "string" },
  "flat-rate": { type: "string" },
  limit: { type: "string" },
  only: { type: "string" },
  refresh: { type: "boolean" },
  metric: { type: "string" },
  pension: { type: "string" },
  age: { type: "string" },
  children: { type: "string" },
  partner: { type: "string" },
  "partner-in": { type: "string", multiple: true },
  "partner-age": { type: "string" },
  married: { type: "boolean" },
  regime: { type: "string", multiple: true },
  "partner-regime": { type: "string", multiple: true },
  "health-premium": { type: "string", multiple: true },
  "childcare-cost": { type: "string", multiple: true },
  "no-paid-childcare": { type: "boolean" },
  full: { type: "boolean" },
  kind: { type: "string" },
} as const;

type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function number(s: string, what: string): number {
  const m = /^(-?[\d.,_]+)\s*([km])?$/i.exec(s.trim());
  const n = m ? Number(m[1]!.replace(/[,_]/g, "")) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${what}: "${s}" is not a number.`);
  return n;
}

/** "70k EUR", "1200", "85000GBP" */
export function parseMoney(s: string, fallbackCurrency?: string): Money {
  const m = /^\s*([-\d.,_]+\s*[km]?)\s*([A-Za-z]{3})?\s*$/i.exec(s);
  if (!m) throw new Error(`"${s}" is not an amount such as "70k EUR".`);
  const currency = m[2]?.toUpperCase() ?? fallbackCurrency;
  return { amount: number(m[1]!, "amount"), ...(currency ? { currency } : {}) };
}

/** "5%", "0.05" or "5" (a number over 1 is read as a percentage). */
export function parseShare(s: string, what: string): number {
  const v = number(s.replace(/%$/, ""), what);
  const share = s.trim().endsWith("%") || v > 1 ? v / 100 : v;
  if (!(share >= 0 && share <= 0.5)) throw new Error(`${what}: a share of gross from 0 to 50%, got "${s}".`);
  return share;
}

/** "450/month", "5400 / year": an amount with the period it is for; without one it is refused, never guessed. */
export function parsePeriod(s: string, what: string): PeriodAmount {
  const m = /^\s*([\d.,_]+\s*[km]?)\s*\/\s*(month|year|mo|yr|a month|a year)\s*$/i.exec(s);
  if (!m) throw new Error(`${what}: "${s}" needs its period, such as "450/month" or "5400/year".`);
  const per = /^(year|yr|a year)$/i.test(m[2]!) ? "year" : "month";
  return { amount: number(m[1]!, what), per };
}

function sameCurrency(m: Money, currency: string | undefined): number {
  if (m.currency && currency && m.currency !== currency) throw new Error(`--partner is in ${m.currency}, the gross in ${currency}: give both in one currency.`);
  return m.amount;
}

const ages = (s: string) => s.split(/[,\s]+/).filter(Boolean).map((x) => number(x, "--children"));

function pair(s: string, sep: string, what: string): [string, string] {
  const i = s.lastIndexOf(sep);
  if (i <= 0) throw new Error(`${what}: expected "key${sep}value", got "${s}".`);
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

function scores(s: string): Record<string, number> {
  return Object.fromEntries(s.split(",").map((x) => pair(x, "=", "scores")).map(([k, v]) => [k, number(v, k)]));
}

export function compareArgs(positionals: string[], f: Flags): QueryArgs {
  const base: Partial<QueryArgs> = f.args ? JSON.parse(readFileSync(f.args, "utf8")) : {};
  const a: QueryArgs = { ...base, cities: positionals.length ? positionals : (base.cities ?? []) };
  if (f.preset) a.preset = f.preset;
  if (f.only) a.only = f.only.split(",").map((x) => x.trim()).filter(Boolean);
  if (f.weight) a.weights = { ...a.weights, ...Object.fromEntries(f.weight.map((w) => pair(w, "=", "--weight")).map(([k, v]) => [k, number(v, k)])) };
  if (f.person) a.household = f.person.map((p) => {
    const [label, codes] = p.includes("=") ? pair(p, "=", "--person") : [undefined, p];
    return { ...(label ? { label } : {}), passports: codes.split(/[,\s]+/).filter(Boolean) };
  });
  if (f.age || f.partner || f["partner-in"] || f.married || f["partner-age"] || f["partner-regime"]) {
    const people = [...(a.household ?? [])];
    const need = f.partner || f["partner-in"] || f.married || f["partner-age"] || f["partner-regime"] ? 2 : 1;
    // People without a --person have unknown passports: their right to live there is reported as not checked.
    while (people.length < need) people.push({});
    if (f.age) people[0] = { ...people[0]!, age: number(f.age, "--age") };
    if (need === 2) {
      people[1] = {
        ...people[1]!,
        ...(f.partner ? { salary: parseMoney(f.partner, f.currency) } : {}),
        ...(f["partner-in"] ? { salaryByCity: Object.fromEntries(f["partner-in"].map((x) => pair(x, "=", "--partner-in")).map(([k, v]) => [k, parseMoney(v, f.currency)])) } : {}),
        ...(f["partner-age"] ? { age: number(f["partner-age"], "--partner-age") } : {}),
        ...(f.married ? { spouse: true } : {}),
        ...(f["partner-regime"] ? { regimes: { ...people[1]!.regimes, ...Object.fromEntries(f["partner-regime"].map((x) => pair(x, ":", "--partner-regime")).map(([k, v]) => [k.toUpperCase(), v])) } } : {}),
        relation: "partner",
      };
    }
    a.household = people;
  }
  if (f.pension) a.pension = parseShare(f.pension, "--pension");
  if (f["health-premium"]) a.healthPremium = { ...a.healthPremium, ...Object.fromEntries(f["health-premium"].map((x) => pair(x, "=", "--health-premium")).map(([k, v]) => [k, parsePeriod(v, "--health-premium")])) };
  if (f["childcare-cost"]) a.childcareCost = { ...a.childcareCost, ...Object.fromEntries(f["childcare-cost"].map((x) => pair(x, "=", "--childcare-cost")).map(([k, v]) => [k, parsePeriod(v, "--childcare-cost")])) };
  if (f["no-paid-childcare"]) a.paidChildcare = false;
  if (f.children) a.children = ages(f.children);
  if (f.regime) a.regimes = { ...a.regimes, ...Object.fromEntries(f.regime.map((x) => pair(x, ":", "--regime")).map(([k, v]) => [k.toUpperCase(), v])) };
  if (f.salary) a.salary = parseMoney(f.salary, f.currency);
  if (f["salary-in"]) a.salaryByCity = { ...a.salaryByCity, ...Object.fromEntries(f["salary-in"].map((s) => pair(s, "=", "--salary-in")).map(([k, v]) => [k, parseMoney(v, f.currency)])) };
  if (f.display) a.displayCurrency = f.display;
  if (f.housing) {
    if (f.housing !== "1bed" && f.housing !== "3bed") throw new Error("--housing is 1bed or 3bed.");
    a.housing = f.housing as HousingSize;
  }
  if (f.spending) a.spending = { ...parseMoney(f.spending, f.currency), ...(f.home ? { homeCity: f.home } : {}) };
  if (f.savings) a.savings = number(f.savings, "--savings");
  if (f.comfort) {
    const [min, max] = pair(f.comfort, "-", "--comfort");
    a.comfort = { min: number(min, "--comfort"), max: number(max, "--comfort") };
  }
  if (f["comfort-air"]) a.comfort = { ...(a.comfort ?? DEFAULT_COMFORT), basis: "air" };
  if (f.relative) a.normalise = "relative";
  if (f["missing-worst"]) a.missing = "worst";
  if (f["missing-skip"]) a.missing = "skip";
  if (f["deal-breaker"]) a.dealBreakers = f["deal-breaker"];
  if (f.stance) a.stances = { ...a.stances, ...Object.fromEntries(f.stance.map((s) => pair(s, "=", "--stance"))) };
  if (f.override) {
    const o: Record<string, Record<string, number>> = { ...a.overrides };
    for (const s of f.override) {
      const [city, rest] = pair(s, ":", "--override");
      const [metric, v] = pair(rest, "=", "--override");
      o[city] = { ...o[city], [metric]: number(v, metric) };
    }
    a.overrides = o;
  }
  if (f.line) a.personal = [...(a.personal ?? []), ...f.line.map((l) => { const [label, s] = pair(l, ":", "--line"); return { label, scores: scores(s) }; })];
  if (f["tax-tweak"]) {
    const t: Record<string, TaxTweak> = { ...a.taxTweaks };
    for (const s of f["tax-tweak"]) {
      const [country, rest] = pair(s, ":", "--tax-tweak");
      const [key, v] = pair(rest, "=", "--tax-tweak");
      if (key !== "taxableShare" && key !== "flatRate" && key !== "noSocialContributions") throw new Error("--tax-tweak keys are taxableShare, flatRate and noSocialContributions.");
      t[country.toUpperCase()] = { ...t[country.toUpperCase()], [key]: key === "noSocialContributions" ? v === "1" || v === "true" : number(v, key) };
    }
    a.taxTweaks = t;
  }
  return a;
}

function runPipeline(rel: string): boolean {
  const r = spawnSync(process.execPath, [join(ROOT, rel)], { cwd: ROOT, stdio: "inherit" });
  return r.status === 0;
}

function data(sub: string | undefined, name: string | undefined): number {
  const available = readdirSync(join(ROOT, "pipeline/sources")).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")).sort();
  if (sub === "build") return runPipeline("pipeline/build-data.ts") ? 0 : 1;
  if (sub !== "refresh") throw new Error(`Use "data build" or "data refresh [source]". Sources: ${available.join(", ")}.`);
  if (name && !available.includes(name)) throw new Error(`Unknown source "${name}". Sources: ${available.join(", ")}.`);
  const failed = (name ? [name] : available).filter((s) => {
    console.error(`refreshing ${s}…`);
    return !runPipeline(`pipeline/sources/${s}.ts`);
  });
  if (failed.length) console.error(`failed: ${failed.join(", ")} (their previous files are kept)`);
  const built = runPipeline("pipeline/build-data.ts");
  return failed.length || !built ? 1 : 0;
}

/** Amounts, weights and shares are never negative: say so before the option parser reads "-85000" as an option. */
function refuseNegative(argv: string[]): void {
  argv.forEach((t, i) => {
    if (/^-\d/.test(t) && argv[i - 1] !== "--comfort") throw new Error(`${t}: amounts, weights and shares cannot be negative; give a figure of 0 or more.`);
  });
}

export async function main(argv: string[]): Promise<number> {
  refuseNegative(argv);
  const { values: f, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const [cmd, ...rest] = positionals;
  if (f.help || !cmd || cmd === "help") {
    console.log(HELP);
    return 0;
  }
  const print = (json: unknown, text: string) => console.log(f.json ? JSON.stringify(json, null, 2) : text);
  if (cmd === "data") return data(rest[0], rest[1]);
  if (cmd === "mcp") {
    const { serve } = await import("../mcp/stdio.ts");
    await serve();
    return -1; // keeps running until the client closes stdin
  }
  const ds = loadDataset();
  switch (cmd) {
    case "compare": {
      const r = compare(ds, compareArgs(rest, f));
      if (f.svg) writeFileSync(f.svg, compareSvg(chartInput(r)));
      if (f.full) print(r, compareMarkdown(r));
      else {
        const limit = f.limit ? number(f.limit, "--limit") : undefined;
        const s = summarize(r, { limit });
        print(s, summaryMarkdown(s, summaryWhy(r, limit)));
      }
      return 0;
    }
    case "city": {
      if (!rest[0]) throw new Error("Which city? e.g. borgo city Turin");
      const r = cityReport(ds, rest.join(" "), { passports: f.person?.map((p) => p.split(/[,\s]+/).filter(Boolean)), metrics: f.metric?.split(",").map((x) => x.trim()).filter(Boolean), detail: f.full ? "full" : "summary" });
      print(r, cityMarkdown(r));
      return 0;
    }
    case "net-pay": {
      const [where, gross] = rest;
      if (!where || !gross) throw new Error("Usage: borgo net-pay <country|city> <gross>, e.g. net-pay IT 60000 or net-pay Edinburgh 50k");
      const isCountry = /^[A-Za-z]{2}$/.test(where) || Object.values(ds.countries).some((c) => c.name.toLowerCase() === where.toLowerCase());
      const tweak: TaxTweak = {};
      if (f["taxable-share"]) tweak.taxableShare = number(f["taxable-share"], "--taxable-share");
      if (f["flat-rate"]) tweak.flatRate = number(f["flat-rate"], "--flat-rate");
      const g = parseMoney(gross, f.currency);
      const r = netPay(ds, {
        ...(isCountry ? { country: where } : { city: where }),
        region: f.region,
        gross: g.amount,
        currency: g.currency,
        displayCurrency: f.display,
        tweak: Object.keys(tweak).length ? tweak : undefined,
        age: f.age ? number(f.age, "--age") : undefined,
        children: f.children ? ages(f.children) : undefined,
        pension: f.pension ? parseShare(f.pension, "--pension") : undefined,
        regime: f.regime?.[0]?.includes(":") ? pair(f.regime[0], ":", "--regime")[1] : f.regime?.[0],
        partner: f.partner || f.married ? { gross: f.partner ? sameCurrency(parseMoney(f.partner, g.currency), g.currency) : 0, age: f["partner-age"] ? number(f["partner-age"], "--partner-age") : undefined, spouse: !!f.married } : undefined,
      });
      print(r, netPayMarkdown(r));
      return 0;
    }
    case "search": {
      const q = rest.join(" ");
      const all = searchCities(ds, q, { country: f.country, limit: 100_000 });
      const hits = all.slice(0, f.limit ? number(f.limit, "--limit") : rest.length ? 10 : 1000);
      const rows = hits.map((h) => ({ id: h.city.id, name: h.city.name, country: h.city.country, population: h.city.population ?? null }));
      const more = all.length > hits.length ? `\n${all.length - hits.length} more match: raise --limit.` : "";
      print(
        { reportVersion: REPORT_VERSION, total: all.length, hasMore: all.length > hits.length, cities: rows },
        rows.length ? rows.map((r) => `${r.id.padEnd(22)} ${r.name} (${r.country})`).join("\n") + more : `No city in the dataset matches "${q}". Any real place works: borgo fetch "${q}${f.country ? `, ${f.country.toUpperCase()}` : ""}".`,
      );
      return 0;
    }
    case "fetch": {
      if (!rest[0]) throw new Error('Which place? e.g. borgo fetch "Palermo, IT"');
      const only = f.only?.split(",").map((x) => x.trim()).filter(Boolean);
      const r = await fetchPlace(ds, rest.join(" "), {
        only,
        refresh: f.refresh,
        onProgress: f.json ? undefined : (o) => o.status !== "running" && console.error(`  ${o.source.padEnd(18)} ${o.status}${"count" in o && o.count ? ` (${o.count})` : ""}${"reason" in o && o.reason && o.status !== "ok" ? `: ${o.reason}` : ""}`),
      });
      print(f.full ? r : placeFetchSummary(r, ds, REPORT_VERSION), placeFetchMarkdown(r, ds, f.full ? "full" : "summary"));
      return r.fetched.outcomes.some((o) => o.status === "ok") ? 0 : 1;
    }
    case "sources": {
      const rows = listSources(loadRegistry().entries, { metric: f.metric, country: f.country });
      print(rows, sourcesMarkdown(rows));
      return 0;
    }
    case "catalogue": {
      if (f.kind) {
        if (!(CATALOGUE_KINDS as readonly string[]).includes(f.kind)) throw new Error(`--kind is one of ${CATALOGUE_KINDS.join(", ")}.`);
        const part = cataloguePart(ds, f.kind as CatalogueKind, f.country);
        print(part, cataloguePartMarkdown(part));
        return 0;
      }
      const c = catalogue(ds);
      print(c, catalogueMarkdown(c));
      return 0;
    }
    case "methodology": {
      const text = methodology(ds);
      print({ markdown: text }, text);
      return 0;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run borgo --help.`);
  }
}

export async function run(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  try {
    const code = await main(argv);
    if (code >= 0) process.exitCode = code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (json) console.log(JSON.stringify({ error: msg }));
    console.error(msg);
    process.exitCode = 1;
  }
}
