// The MCP server a person runs themselves (npm, stdio): every tool of tools.ts plus those that need their machine:
// fetch_city fetches any place into their cache, record_observation keeps a figure there, list_stale and
// propose_change read this checkout and post a proposal with their GitHub CLI once they agreed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { observationProblems } from "../core/metrics.ts";
import type { Dataset, Observation } from "../core/types.ts";
import { findCity } from "../agent/cities.ts";
import { fetchPlace, placeFetchMarkdown, placeFetchSummary } from "../agent/fetch-place.ts";
import type { FetchCtx } from "../fetch/context.ts";
import { addFetched, type CityFetch } from "../fetch/index.ts";
import { loadCity, saveCity } from "../fetch/node/cache.ts";
import { loadRegistry } from "../registry/load.ts";
import type { RegistryEntry } from "../registry/schema.ts";
import { REPORT_VERSION } from "../agent/report.ts";
import { viewHtml } from "./view.ts";
import { listStale, proposeChange, proposeMarkdown, type Poster } from "../community/agent.ts";
import type { Http } from "../community/net.ts";
import { CITATION_TYPES, KINDS, type RepoView } from "../community/proposal.ts";
import { loadCorrections, repoView } from "../community/repo.ts";
import { FACT_KINDS } from "../community/stale.ts";
import { guarded, guardedAsync, INSTRUCTIONS, looseOutput, openWorld, readOnly, registerShared, reply, SERVER_INFO, SERVER_VERSION } from "./tools.ts";

export { INSTRUCTIONS } from "./tools.ts";

export interface ServerOptions {
  /** The registry (default: registry/ on disk). */
  registry?: RegistryEntry[];
  /** How fetches reach the network (tests pass a recorded one). */
  ctx?: () => FetchCtx;
  /** The repository the proposal checks read (default: this checkout). */
  repo?: RepoView;
  /** How propose_change opens cited pages (default: the guarded real network). */
  http?: Http;
  /** How propose_change posts an issue once the person agreed (default: their signed-in GitHub CLI). */
  poster?: Poster;
  /** Today, YYYY-MM-DD, for list_stale (default: the clock). */
  today?: () => string;
  /** How the community tools reach Borgo's site (tests pass a stand-in). */
  communityFetch?: typeof fetch;
}

export function createServer(data: Dataset, opts: ServerOptions = {}): McpServer {
  const registry = opts.registry ?? loadRegistry().entries;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerShared(server, data, { registry, view: viewHtml, local: true, communityFetch: opts.communityFetch });

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

  const level = z.enum(["city", "metro", "region", "country"]);
  server.registerTool(
    "list_stale",
    {
      title: "Facts due for review",
      description:
        "The facts Borgo encodes by hand (tax models, abortion and same-sex couples law, paid leave, election results, residence rules, corrected figures), each with the day it is due to be compared with its official source again, the most overdue first. Each row says why it is due, links its current source and gives the target to use with propose_change.",
      inputSchema: {
        within: z.number().int().min(0).max(3650).optional().describe("Also list facts due within this many days (default 0: only those already due)"),
        kind: z.enum(FACT_KINDS).optional().describe("Only one kind of fact"),
        country: z.string().optional().describe("ISO alpha-2: only this country's facts"),
        asOf: z.string().optional().describe("The day to compare against, YYYY-MM-DD (default today)"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
      },
      outputSchema: looseOutput,
      annotations: readOnly,
    },
    guarded(({ within, kind, country, asOf, limit }) => {
      const r = listStale({ within, kind, country, asOf: asOf ?? opts.today?.(), limit }, { corrections: loadCorrections(), registry, name: (c) => data.countries[c]?.name ?? c });
      const { markdown, ...rest } = r;
      return reply(markdown, { reportVersion: REPORT_VERSION, ...rest });
    }),
  );

  server.registerTool(
    "propose_change",
    {
      title: "Propose a correction",
      description:
        "Turn a correction to a Borgo figure, rule or source into a proposal the maintainers review, checked the way the project's GitHub workflow checks it: the target exists, the value has the metric's shape and unit, the citation is an official text (statute, gazette, official table or page, or a registry source) and not a link-only site, a rule cites its legal text, and the cited page answers and holds the quote. Returns the verdict and a prefilled GitHub issue link for the person to open and submit (public, under their account, data under CC BY 4.0). Posts nothing by itself: to post with the person's signed-in GitHub CLI, show them the proposal and call again with post.confirm set to the token this call returns, only after they say yes.",
      inputSchema: {
        kind: z.enum(KINDS).describe("correction (a figure shown is wrong), figure (a figure Borgo lacks), rule-change (a tax, leave, residence or law rule), source (a registry entry), link (a broken or missing address)"),
        city: z.string().optional().describe("For a figure: the city id (search_cities)"),
        metric: z.string().optional().describe("For a figure: the metric id"),
        source: z.string().optional().describe("For a figure: the registry source id it comes from (get_city shows it)"),
        file: z.string().optional().describe("For a rule, source or link: the file, e.g. src/tax/it.ts or registry/ons-pipr.json (list_stale gives it)"),
        path: z.string().optional().describe("For a rule, source or link: what inside the file changes, e.g. ABORTION.US-NY or homepage"),
        current: z.string().optional().describe("The value shown now"),
        proposed: z.union([z.string(), z.number(), z.array(z.number())]).describe("A figure in the metric's unit (12 numbers for a monthly one), or the new rule in a sentence"),
        unit: z.string().optional().describe("The figure's unit, e.g. GBP/month"),
        period: z.string().optional().describe("The time the value describes, e.g. 2026-09"),
        level: level.optional().describe("The area the value describes"),
        citation: z
          .object({
            url: z.string().describe("The official text's address"),
            type: z.enum(CITATION_TYPES).describe("statute, gazette, official-table, official-page or registry; news and other pages go in leads"),
            publisher: z.string(),
            title: z.string(),
            accessed: z.string().describe("YYYY-MM-DD"),
            quote: z.string().optional().describe("A sentence copied exactly from the page that states the value; checked on the page"),
          })
          .describe("The primary citation: the official text itself"),
        leads: z.array(z.string()).optional().describe("News or other pages that pointed to the change: leads, never citations"),
        agent: z.string().describe("Your name and version, name@1.0"),
        operator: z.string().describe("The person or project that runs you and answers for the proposal"),
        note: z.string().optional().describe("For the reviewer; public, so no personal details"),
        offline: z.boolean().optional().describe("Skip opening the cited pages"),
        post: z.object({ confirm: z.string() }).optional().describe("Only after the person agreed to post this exact proposal: the confirm token from the previous call"),
      },
      outputSchema: looseOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guardedAsync(async (args) => {
      const r = await proposeChange(args, { repo: opts.repo ?? repoView(), http: opts.http, poster: opts.poster });
      return reply(proposeMarkdown(r), { reportVersion: REPORT_VERSION, valid: r.valid, problems: r.verdict.problems, warnings: r.verdict.warnings, route: r.verdict.route, locked: r.verdict.locked, labels: r.verdict.labels, next: r.verdict.next, title: r.title, issueUrl: r.issueUrl, confirm: r.confirm, posted: r.posted, notPosted: r.notPosted ?? null, proposal: r.proposal });
    }),
  );

  return server;
}
