// The MCP server: the app's whole engine as tools, each answering in markdown for people and JSON for programs.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CRITERIA } from "../core/criteria.ts";
import { pensionPlans } from "../tax/pension.ts";
import { observationProblems } from "../core/metrics.ts";
import { PRESETS } from "../core/presets.ts";
import type { Dataset, Observation } from "../core/types.ts";
import { findCity, searchCities } from "../agent/cities.ts";
import { fetchPlace, placeFetchMarkdown } from "../agent/fetch-place.ts";
import { listSources, sourcesMarkdown } from "../agent/sources.ts";
import type { FetchCtx } from "../fetch/context.ts";
import { addFetched, type CityFetch } from "../fetch/index.ts";
import { loadCity, saveCity } from "../fetch/node/cache.ts";
import { loadRegistry } from "../registry/load.ts";
import type { RegistryEntry } from "../registry/schema.ts";
import { catalogueMarkdown, cataloguePartMarkdown, cityMarkdown, compareMarkdown, netPayMarkdown, summaryMarkdown } from "../agent/markdown.ts";
import { methodology } from "../agent/methodology.ts";
import { CATALOGUE_KINDS, catalogue, cataloguePart, cityReport, compare, dsInfo, netPay, REPORT_VERSION, summarize, summaryWhy } from "../agent/report.ts";
import { placeFetchSummary } from "../agent/fetch-place.ts";
import { VIEW_MIME, VIEW_URI, viewHtml } from "./view.ts";

export const INSTRUCTIONS = `Borgo compares cities to live in on open, sourced data, weighted by the person's own values, and works out take-home pay and what is left after rent and everyday spending.

Use it for any question about where to live, relocating or moving abroad, comparing cities, cost of living, rent, take-home pay or net salary in another country, quality of life, climate or air quality of a city, or whether someone's passports let them live and work there.

How to use it well:
- compare_cities is the main tool. Pass the cities and only what the person told you: passports (household; leave a person's passports out when you do not know them, and that person's right to live there is reported as not checked), salary or per-city offers with currency, a partner's pay and whether they are married, ages, children's ages, a pension share, monthly spending and where they live now (this unlocks the break-even salary), housing size, what matters to them (a preset, explicit weights 0-100, or \`only\` for a one-line question such as only: ["nice_days"]), must-pass lines (dealBreakers), their own 1-5 lines. Never invent a salary, spending or passports: leave them out and relay "what to add next".
- Answers are compact by default (detail "summary", the top 10 cities). Ask for detail "full" only when the person wants every tax line and source; use \`limit\` for long lists.
- Lead with the verdict and its qualifiers: a must-pass that cannot be checked is "unknown" and is never a pass; a city without a figure on a line is scored as the lowest compared city on it; money is compared on one basis for every city, and the notes say which and what input would fix it. Relay the notes, the required unknowns and the next inputs.
- Any real place works, not only the cities already in the dataset: fetch_city resolves it ("Palermo, IT") and fetches every source that covers it into the person's cache, with provenance; then use its id in the other tools.
- Link-only sources (Numbeo, WeatherSpark and the other pages list_sources marks link-out) forbid copying and automated reading: never fetch or read them yourself. Give the person the link; if they read a figure there and tell you, record_observation keeps it in their own cache with the page's address, never published. Open sources you may read (a statistics office table) can be recorded the same way.
- The places the person asks about go to the named data providers (Open-Meteo, the World Bank and others) as names or coordinates; their salary, weights and household never do.
- search_cities finds ids (a miss means: try fetch_city); get_city gives a city's figures with source, period, level and licence (pass \`metrics\` for a few, \`passports\` for who may live there); net_pay answers take-home pay questions on their own; list_metrics_and_sources (filter with \`kind\`, e.g. kind "regimes" and country "NL") and methodology explain what the scores mean.
- Position lines (politics, abortion, couples_law) are stances, not more-is-better: pass a stance only when the person stated it or you already know it from them, never from their nationality, city or any other guess, and give the line a weight. Report each place's fact in neutral words, with its date.
- Quote figures with their source and period. Rankings depend on the weights: no ranking is objective.`;

const money = z.object({ amount: z.number().describe("Amount"), currency: z.string().optional().describe("ISO 4217, e.g. EUR, GBP, USD. Default: the display currency") });
const tweak = z.object({
  taxableShare: z.number().min(0).max(1).optional().describe("Share of gross that is taxable, e.g. 0.5 under an impatriate regime"),
  flatRate: z.number().min(0).max(1).optional().describe("Flat income tax rate replacing the schedule, e.g. 0.24"),
  noSocialContributions: z.boolean().optional().describe("You pay none of the country's employee social contributions, e.g. a foreigner on a Singapore Employment Pass pays no CPF"),
  note: z.string().optional(),
});
const criteriaIds = CRITERIA.map((c) => c.id).join(", ");
const MODELLED_PENSIONS = pensionPlans().filter((x) => x.status === "modelled").map((x) => `${x.country} (${x.plan})`).join(", ");
const periodAmount = z.object({ amount: z.number().min(0).describe("Amount, in the city's own currency"), per: z.enum(["month", "year"]).describe("What the amount is for: a month or a year") });

const compareInput = {
  cities: z.array(z.string()).describe("City ids (e.g. turin-it) or names in any common spelling (Turin, Torino, 'Paris, FR'); a name two places share needs its country"),
  preset: z.enum(PRESETS.map((p) => p.id) as [string, ...string[]]).optional().describe("Starting weights"),
  weights: z.record(z.string(), z.number().min(0).max(100)).optional().describe(`Weight 0-100 per criterion, on top of the preset. Criteria: ${criteriaIds}`),
  only: z.array(z.string()).optional().describe('Score only these criteria; every other line gets weight 0 (each listed one keeps its `weights` value, else 100). For a one-line question: only ["nice_days"] with comfort {min:20,max:28}'),
  detail: z.enum(["summary", "full"]).optional().describe('"summary" (default): verdict, ranking, weighted lines with citations, money in brief, who can move there, notes, required unknowns and next inputs. "full": every line, tax line and source, for programs'),
  limit: z.number().int().min(1).max(500).optional().describe("How many ranked cities to describe in the summary (default 10); the ranking counts the rest"),
  household: z
    .array(
      z.object({
        label: z.string().optional(),
        passports: z.array(z.string()).optional().describe("ISO alpha-2 codes, e.g. ['IT','US'], if known. Leave out when you do not know them: that person's right to live there is then reported as not checked, never as needing a visa"),
        regimeConfirmations: z.record(z.string(), z.boolean()).optional().describe('This person\'s answers to newcomer-regime conditions no dataset can check, by condition id (list_metrics_and_sources kind "regimes"), e.g. {"nl-recruited-abroad": true}. Only what the person told you'),
        age: z.number().int().min(14).max(110).optional().describe("Age in years: age-dependent tax (youth relief, care insurance), pension caps, paid leave, newcomer regimes"),
        salary: money.optional().describe("Not for the first person (use `salary`): this person's gross yearly pay, the same everywhere"),
        salaryByCity: z.record(z.string(), money).optional().describe("Not for the first person: this person's gross per city, keyed by city id or name"),
        pension: z.number().min(0).max(0.5).optional().describe("This person's pension share of gross, 0.05 = 5%"),
        spouse: z.boolean().optional().describe("Married to (or registered partner of) the first person: joint filing where the country has it, applied when it is required or cheaper"),
        relation: z.enum(["partner", "cofounder", "family"]).optional().describe("Partner decides couple vs single-parent childcare"),
        yearsSinceResident: z.record(z.string(), z.union([z.number().int().min(0), z.literal("never")])).optional().describe("Whole years since last tax resident there, by ISO alpha-2, or 'never': for newcomer regimes"),
        regimes: z.record(z.string(), z.string()).optional().describe("Not for the first person (use `regimes`): newcomer regimes this person chose, ISO alpha-2 -> regime id, checked against this person's own facts and confirmations; a scenario until they meet every condition"),
      }),
    )
    .optional()
    .describe("Everyone moving, you first. Anyone after you can bring their own pay; a spouse counts for joint filing even with none"),
  salary: money.optional().describe("Your gross yearly salary, the same everywhere"),
  pension: z.number().min(0).max(0.5).optional().describe(`Share of your gross paid into a pension, 0.05 = 5%: it leaves take-home pay and is shown as saving, not cost. Tax relief is modelled for ${MODELLED_PENSIONS}; elsewhere it is not modelled and the share is counted as saving with no relief (each city's money says which)`),
  children: z.array(z.number().min(0).max(29)).optional().describe("Children's ages: childcare after public support for under-6s (OECD), child credits and allowances where the tax uses them, health for each person"),
  paidChildcare: z.boolean().optional().describe("Whether the household pays for childcare for its children under 6 (default true). false: no childcare cost is counted. Ask when it matters: the default prices full-time care for an OECD reference household"),
  childcareCost: z.record(z.string(), periodAmount).optional().describe("What the household actually pays for childcare in a city, after support, keyed by city id or name, in the city's currency, with per \"month\" or \"year\": replaces the OECD reference figure"),
  healthPremium: z.record(z.string(), periodAmount).optional().describe("The household's health insurance premium bought outside pay (US, CH, NL), keyed by city id or name, in the city's currency, with per \"month\" or \"year\" (a year is counted as a twelfth a month)"),
  regimes: z.record(z.string(), z.string()).optional().describe("Newcomer tax regime per country, ISO alpha-2 -> regime id from list_metrics_and_sources. None counts unless named here; a named one is a scenario until the person's facts and confirmations meet every condition"),
  salaryByCity: z.record(z.string(), money).optional().describe("Gross yearly salary per city (offers or estimates), keyed by city id or name"),
  displayCurrency: z.string().optional().describe("Currency to show amounts in (default: the salary's, else EUR)"),
  housing: z.enum(["1bed", "3bed"]).optional(),
  spending: money.extend({ homeCity: z.string().optional().describe("Where you spend this today; default: the first city") }).optional().describe("Monthly spending on everything except housing, childcare and health, which are counted separately"),
  savings: z.number().optional().describe("Savings in the display currency, for runway"),
  comfort: z.object({ min: z.number(), max: z.number(), basis: z.enum(["feels", "air"]).optional() }).optional().describe("Comfortable daytime temperature for the Nice days line, °C: a dry, mostly clear day whose average from 8 am to 8 pm is inside it counts. Default 18-30 on the feels-like temperature; basis \"air\" uses the air temperature in the shade"),
  normalise: z.enum(["absolute", "relative"]).optional(),
  missing: z.enum(["lowest", "skip", "worst"]).optional().describe("A city without a figure on a line: \"lowest\" (default) scores it as the lowest compared city, \"worst\" as 0, \"skip\" leaves the line out for every city. Money is never filled in either way"),
  overrides: z.record(z.string(), z.record(z.string(), z.number())).optional().describe("Your own numbers: city -> metric id -> value; money in the city's currency. health_premium is the household's premium a month (prefer healthPremium, which takes the period); childcare_cost is the household's own childcare a month (prefer childcareCost); childcare_net_couple_1 and similar replace the OECD reference figure, a year"),
  dealBreakers: z.array(z.string()).optional().describe("Must-pass criterion ids, e.g. right_to_live, money_left: a city fails, passes, or is unknown (no figure, a passport not given); unknown ranks after every city that passes"),
  stances: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .optional()
    .describe(
      "Where the person stands on the position lines, which score a place by its distance from them: politics 0 (left) to 10 (right); abortion 0 not allowed or only to save her life, 1 also for her health or after rape, 2 also on social or economic grounds, 3 on request in the first weeks only, 4 on request to 10 weeks or later; couples_law 0 criminalised (same-sex relations a crime), 1 legal with no union in law, 2 civil union or partnership, 3 marriage. Pass only what the person told you or what you know they hold; never guess. A stance counts once its line has a weight (they are 0 by default)",
    ),
  personal: z.array(z.object({ label: z.string(), scores: z.record(z.string(), z.number().min(1).max(5)) })).optional().describe("Your own 1-5 lines, scores keyed by city"),
  taxTweaks: z.record(z.string(), tweak).optional().describe("Per-country tax tweaks keyed by ISO alpha-2"),
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Output schemas: the fields an agent can rely on, versioned by reportVersion; reports may carry more.
const version = { reportVersion: z.string().describe(`The report's shape version (now ${REPORT_VERSION})`) };
const rankRow = z.looseObject({
  rank: z.number(),
  id: z.string(),
  name: z.string(),
  total: z.number().describe("Score out of 100"),
  coverage: z.number().describe("Share of the weight scored on observed figures, 0-1"),
  status: z.enum(["passes", "unknown", "ruled out"]).describe("Must-pass outcome"),
  unresolved: z.array(z.string()),
  ruledOut: z.array(z.string()),
});
const compareOutput = z.looseObject({
  ...version,
  detail: z.enum(["summary", "full"]),
  verdict: z.string().describe("Who leads, qualified when a must-pass is unknown, when the lead is provisional, and when money was compared on another basis"),
  provisional: z.boolean().describe("True when missing figures, partial money or money compared on another basis could still change who leads: say so"),
  provisionalReasons: z.array(z.string()),
  moneyBasis: z.looseObject({ requested: z.string(), used: z.string() }).nullable().describe("The money line asked for and the basis it was compared on for every city"),
  notes: z.array(z.string()).describe("How this set was scored: a line on another basis or left out for every city, periods that differ"),
  requiredUnknowns: z.array(z.looseObject({ id: z.string(), name: z.string(), lines: z.array(z.string()) })),
  assumptions: z.array(z.string()),
  ranking: z.array(rankRow),
  cities: z.array(z.looseObject({ id: z.string(), name: z.string(), rank: z.number() })),
  displayCurrency: z.string(),
});
const cityOutput = z.looseObject({ ...version, detail: z.enum(["summary", "full"]), note: z.string().nullable(), city: z.looseObject({ id: z.string(), name: z.string(), country: z.string() }), figures: z.array(z.looseObject({ metric: z.string() })), rights: z.array(z.looseObject({ person: z.string(), status: z.enum(["yes", "no", "unknown"]), text: z.string() })) });
const netPayOutput = z.looseObject({ ...version, country: z.string(), currency: z.string(), gross: z.number(), net: z.number(), effectiveRate: z.number(), lines: z.array(z.looseObject({ label: z.string(), amount: z.number() })), caveats: z.array(z.string()), sources: z.array(z.looseObject({ label: z.string(), url: z.string() })) });
const searchOutput = z.looseObject({ ...version, total: z.number().describe("Cities that match"), hasMore: z.boolean(), cities: z.array(z.looseObject({ id: z.string(), name: z.string(), country: z.string() })) });
const looseOutput = z.looseObject({ ...version });

function reply(text: string, structured: object): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured as Record<string, unknown> };
}

/** Errors become tool results the agent can read and act on, not protocol failures. */
function guarded<A>(fn: (args: A) => CallToolResult): (args: A) => CallToolResult {
  return (args) => {
    try {
      return fn(args);
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

export interface ServerOptions {
  /** The registry (default: registry/ on disk). */
  registry?: RegistryEntry[];
  /** How fetches reach the network (tests pass a recorded one). */
  ctx?: () => FetchCtx;
}

const openWorld = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Async tools get the same treatment as sync ones: errors become readable results. */
function guardedAsync<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

export function createServer(data: Dataset, opts: ServerOptions = {}): McpServer {
  const registry = opts.registry ?? loadRegistry().entries;
  const server = new McpServer({ name: "borgo", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerResource(
    "compare-chart",
    VIEW_URI,
    { title: "City comparison chart", description: "Interactive view of a compare_cities result: scores by line and money left.", mimeType: VIEW_MIME, _meta: { ui: { prefersBorder: false } } },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: VIEW_MIME, text: viewHtml(), _meta: { ui: { prefersBorder: false } } }] }),
  );

  server.registerTool(
    "search_cities",
    {
      title: "Search cities",
      description: "Find cities already in the dataset (the snapshot and places fetched before) by name, alias or id, optionally within one country. Returns ids for the other tools, how many match and whether more do. A place not found here can still be fetched: call fetch_city.",
      inputSchema: { query: z.string().describe("Name, alias or id; empty lists every city"), country: z.string().optional().describe("ISO alpha-2 filter"), limit: z.number().int().min(1).max(100).optional().describe("Default 10 for a query, 100 for the full list") },
      outputSchema: searchOutput,
      annotations: readOnly,
    },
    guarded(({ query, country, limit }) => {
      const all = searchCities(data, query, { country, limit: 100_000 });
      const hits = all.slice(0, limit ?? (query.trim() ? 10 : 100));
      const rows = hits.map((h) => ({
        id: h.city.id,
        name: h.city.name,
        country: h.city.country,
        region: h.city.region ?? null,
        population: h.city.population ?? null,
        figures: data.observations[h.city.id]?.length ?? 0,
        match: Math.round(h.score * 100) / 100,
      }));
      const more = all.length > hits.length ? `\n\n${all.length - hits.length} more match; raise \`limit\` or narrow the query.` : "";
      const text = rows.length
        ? `${all.length} ${all.length === 1 ? "city matches" : "cities match"}.\n\n| id | City | Country | Population | Figures |\n|---|---|---|---:|---:|\n${rows.map((r) => `| ${r.id} | ${r.name} | ${r.country} | ${r.population?.toLocaleString("en-GB") ?? "–"} | ${r.figures} |`).join("\n")}${more}`
        : `No city in the dataset matches "${query}"${country ? ` in ${country.toUpperCase()}` : ""}. Any real place can still be compared: call fetch_city with "${query}${country ? `, ${country.toUpperCase()}` : ""}", then use the id it returns.`;
      return reply(text, { reportVersion: REPORT_VERSION, total: all.length, hasMore: all.length > hits.length, cities: rows });
    }),
  );

  server.registerTool(
    "get_city",
    {
      title: "Figures for a city",
      description: "One city's figures, each with source, period, geographic level and licence; daylight; the take-home pay model; whether each person in a household may live and work there, with the rules checked; and links to sources we may not copy. Compact by default (figures with a value, long series counted); pass metrics for a few figures, detail \"full\" for everything.",
      inputSchema: {
        city: z.string().describe("City id or name"),
        passports: z.array(z.array(z.string())).optional().describe("Optional: each person's passports, e.g. [['US']] or [['IT'],['US','IE']]: who may live and work there"),
        metrics: z.array(z.string()).optional().describe("Only these metric ids, e.g. ['rent_1bed','pm25']; list_metrics_and_sources kind \"metrics\" lists them"),
        detail: z.enum(["summary", "full"]).optional().describe('"summary" (default) or "full"'),
      },
      outputSchema: cityOutput,
      annotations: readOnly,
    },
    guarded(({ city, passports, metrics, detail }) => {
      const r = cityReport(data, city, { passports, metrics, detail: detail ?? "summary" });
      return reply(cityMarkdown(r), r);
    }),
  );

  server.registerTool(
    "compare_cities",
    {
      title: "Compare cities",
      description:
        "Rank any number of cities for a person or household: a verdict, the score out of 100 from their weights with points and reasons per line, must-pass lines as pass, fail or unknown, each earner's take-home pay and what is left after rent and spending, who can move there, how the set was scored, and what to add next. Every figure carries its source and period. Compact by default; detail \"full\" adds every tax line, childcare, health, leave and break-even.",
      inputSchema: compareInput,
      outputSchema: compareOutput,
      annotations: readOnly,
      _meta: { ui: { resourceUri: VIEW_URI }, "ui/resourceUri": VIEW_URI },
    },
    guarded(({ detail, limit, ...args }) => {
      const r = compare(data, args);
      if (detail === "full") return reply(compareMarkdown(r), r);
      const s = summarize(r, { limit });
      return reply(summaryMarkdown(s, summaryWhy(r, limit)), s);
    }),
  );

  server.registerTool(
    "net_pay",
    {
      title: "Take-home pay",
      description: "Take-home pay for a gross yearly salary in a country (and region or city, for regional and municipal taxes), with every tax line, the model's caveats and its official sources. Takes age, children, a pension share, a newcomer regime, and a partner (joint filing for a married couple where the country has it).",
      inputSchema: {
        country: z.string().optional().describe("ISO alpha-2 or name; optional when city is given"),
        city: z.string().optional().describe("City id or name; sets country, region and municipal taxes"),
        region: z.string().optional().describe("ISO 3166-2 subdivision, e.g. US-CA, GB-SCT, IT-21"),
        gross: z.number().positive().describe("Gross yearly salary"),
        currency: z.string().optional().describe("Currency of gross; default the country's"),
        tweak: tweak.optional(),
        displayCurrency: z.string().optional(),
        age: z.number().int().min(14).max(110).optional().describe("Age in years, where the tax uses it"),
        children: z.array(z.number().min(0).max(29)).optional().describe("Children's ages, for child credits and allowances"),
        pension: z.number().min(0).max(0.5).optional().describe("Pension share of gross, 0.05 = 5%"),
        regime: z.string().optional().describe("A newcomer regime id for this country (list_metrics_and_sources kind \"regimes\")"),
        partner: z
          .object({ gross: z.number().min(0).describe("Their gross yearly salary, in the same currency as gross; 0 for a spouse with no pay"), age: z.number().int().optional(), pension: z.number().min(0).max(0.5).optional(), spouse: z.boolean().optional().describe("Married or registered partners: joint filing where the country has it") })
          .optional()
          .describe("A second earner in the same household"),
      },
      outputSchema: netPayOutput,
      annotations: readOnly,
    },
    guarded((args) => {
      const r = netPay(data, args);
      return reply(netPayMarkdown(r), r);
    }),
  );

  server.registerTool(
    "list_metrics_and_sources",
    {
      title: "Metrics, criteria and sources",
      description: "What the dataset holds: scoring lines with their scales and default weights, metrics with coverage, sources with licences, take-home pay models, newcomer regimes with each condition's id, presets, and the link-only sources. Pass kind for one part (kind \"regimes\", country \"NL\" lists the Dutch regimes and their conditions).",
      inputSchema: {
        kind: z.enum(CATALOGUE_KINDS).optional().describe("One part only; leave out for everything"),
        country: z.string().optional().describe("ISO alpha-2, with kind taxModels or regimes"),
      },
      outputSchema: looseOutput,
      annotations: readOnly,
    },
    guarded(({ kind, country }) => {
      if (kind) {
        const part = cataloguePart(data, kind, country);
        return reply(cataloguePartMarkdown(part), part);
      }
      const c = catalogue(data);
      return reply(catalogueMarkdown(c), { reportVersion: REPORT_VERSION, ...c });
    }),
  );

  server.registerTool(
    "methodology",
    {
      title: "How the scores and money are computed",
      description: "How scores, weights, must-pass lines, missing data, the money model, the right to live and the open-data rule work, with every scale.",
      inputSchema: {},
      outputSchema: looseOutput,
      annotations: readOnly,
    },
    guarded(() => reply(methodology(data), { reportVersion: REPORT_VERSION, dataset: dsInfo(data) })),
  );

  server.registerTool(
    "list_sources",
    {
      title: "The source registry",
      description:
        "The curated list of sources: what each measures (with a plain definition), coverage, licence, whether it may be redistributed, how it is fetched (endpoint, CORS, key) and who vetted it, plus link-only pages such as Numbeo and WeatherSpark. Filter by metric or country; pass a place to get the publisher's page for it.",
      inputSchema: {
        metric: z.string().optional().describe("Metric id, e.g. pm25, rent_1bed, sunshine_hours"),
        country: z.string().optional().describe("ISO alpha-2: only sources covering this country"),
        access: z.enum(["api", "bulk", "curated", "link-out"]).optional(),
        city: z.string().optional().describe("A city id or name in the dataset, to fill in each publisher's page for it"),
      },
      outputSchema: looseOutput,
      annotations: readOnly,
    },
    guarded(({ metric, country, access, city }) => {
      const place = city ? findCity(data, city) : undefined;
      const rows = listSources(registry, { metric, country, access, place });
      return reply(sourcesMarkdown(rows, place ? `Sources for ${place.name}` : "Sources"), { reportVersion: REPORT_VERSION, sources: rows });
    }),
  );

  server.registerTool(
    "fetch_city",
    {
      title: "Fetch any place",
      description:
        "Resolve any real place (\"Palermo, IT\", \"Sligo\", \"Bangalore\", or geonames:<id>; an island or a country, \"Tenerife\" or \"Malta\", is read as its main town or capital, and the answer says so) and fetch its figures from every registry source that covers it: climate (air and feels-like temperature with their spread and extremes, hourly temperature by month, cloud cover, wet days, and day counts: nice, beach, run or ride, muggy, grey, hot nights, heat stress, snow, wind), measured sunshine, air quality, price level, homicides, life expectancy, life satisfaction, research density and official rents. Saved in the person's cache with each figure's URL and time; reused for 30 days unless refresh is set. Returns the city id for compare_cities and get_city, what each source gave, what the place lacks (\"Partial data\": no tax model for its country, no free-movement rules), and other places the name could mean. Compact by default.",
      inputSchema: {
        place: z.string().describe("Place name, optionally with country: \"Palermo, IT\"; or geonames:<id>"),
        sources: z.array(z.string()).optional().describe("Only these registry source ids"),
        refresh: z.boolean().optional().describe("Fetch again even if cached"),
        detail: z.enum(["summary", "full"]).optional().describe('"summary" (default): the id, what each source gave, what the place lacks, figures with long series counted. "full": every value and URL'),
      },
      outputSchema: looseOutput,
      annotations: openWorld,
    },
    guardedAsync(async ({ place, sources, refresh, detail }) => {
      const r = await fetchPlace(data, place, { only: sources, refresh, ctx: opts.ctx?.() });
      if (detail === "full") return reply(placeFetchMarkdown(r, data, "full"), { reportVersion: REPORT_VERSION, detail: "full", ...r });
      return reply(placeFetchMarkdown(r, data, "summary"), placeFetchSummary(r, data, REPORT_VERSION));
    }),
  );

  server.registerTool(
    "record_observation",
    {
      title: "Keep a figure you read",
      description:
        "Keep a figure in this person's cache, with its source id from list_sources, the page URL and the period: one you read in an open source (a city statistics office table), or one the person read on a link-only page (Numbeo) and gave you. Never fetch link-only pages yourself. The figure counts like any other, marked as reported by an agent, unverified; figures from link-only sources are never published by the project.",
      inputSchema: {
        city: z.string().describe("City id or name (fetch_city first for a new place)"),
        metric: z.string().describe("Metric id, e.g. rent_1bed"),
        value: z.union([z.number(), z.array(z.number())]).describe("A number, or 12 monthly numbers for a monthly metric. Money in the city's local currency."),
        unit: z.string().optional().describe("The unit the figure is in, as list_metrics_and_sources gives it (e.g. EUR/month for rent in Lisbon). Checked against the metric's unit; leave it out only when you are sure"),
        source: z.string().describe("Registry source id, e.g. numbeo"),
        url: z.string().url().describe("The page the figure was read on"),
        period: z.string().describe("What time it describes, e.g. 2026 or 2026-09"),
        level: z.enum(["city", "metro", "region", "country"]).optional(),
        note: z.string().optional(),
      },
      outputSchema: looseOutput,
      // Each call replaces the figure from that source and stamps a new time: not idempotent.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guarded(({ city, metric, value, unit, source, url, period, level, note }) => {
      const c = findCity(data, city);
      const m = data.metrics[metric];
      if (!m) throw new Error(`Unknown metric "${metric}". See list_metrics_and_sources.`);
      const entry = registry.find((e) => e.id === source);
      if (!entry) throw new Error(`Unknown source "${source}". Pick one from list_sources, or propose a new registry entry.`);
      // The source must measure the metric, in its unit, inside its plausible range: a wrong figure is refused, not kept.
      const problems = observationProblems(m, entry, { value, url, unit, localCurrency: data.countries[c.country]?.currency ?? "" });
      if (problems.length) throw new Error(`Not kept. ${problems.join(" ")}`);
      // An agent-reported figure is unverified, and says so wherever it shows.
      const o: Observation = { metric, value, period, level: level ?? "city", source, retrieved: new Date().toISOString(), url, fetcher: "agent", note: `Reported by an agent, unverified${note ? `: ${note}` : ""}` };
      const prev: CityFetch = loadCity(c.id) ?? { city: c, observations: [], outcomes: [], fetchedAt: new Date().toISOString() };
      const previous = prev.observations.find((x) => x.source === source && x.metric === metric);
      prev.observations = [...prev.observations.filter((x) => !(x.source === source && x.metric === metric)), o];
      const path = saveCity(prev);
      addFetched(data, [prev]);
      const priv = entry.redistribute === "no" ? " It stays in this person's cache: the source may not be redistributed, so the project never publishes it." : "";
      return reply(`Kept ${m.label} = ${Array.isArray(value) ? value.join(" · ") : value} for ${c.name}, from ${entry.name} (${period}), marked as reported by an agent, unverified. It counts in this person's comparisons from now on${previous ? `, replacing the ${previous.period} figure from the same source` : ""}.${priv}`, { reportVersion: REPORT_VERSION, city: c.id, observation: o, replaced: previous ?? null, path });
    }),
  );

  return server;
}
