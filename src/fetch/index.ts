// Fetching one place on demand: run every fetcher that can run here and covers the place, fallbacks after the
// source they stand in for, and report each source's outcome so a person sees what came back and what did not.
// Browser-safe: Node-only fetchers are added by src/fetch/node/index.ts.
import type { City, Dataset, Observation } from "../core/types.ts";
import { cams } from "./air.ts";
import type { Fetcher, FetchCtx } from "./context.ts";
import { oecd, wgi, worldBank } from "./country.ts";
import { eurostatUrban } from "./eurostat-urban.ts";
import { labourLaw, nagerHolidays, oecdChildcare } from "./family.ts";
import { github } from "./github.ts";
import { openMeteo } from "./open-meteo.ts";
import { politics } from "./politics.ts";
import { csoRent } from "./rent.ts";
import { abortionLaw, couplesLaw } from "./rights-law.ts";
import { openAlex } from "./research.ts";
import { wmoSunshine } from "./sunshine.ts";

/** Fetchers that run anywhere, the browser included. */
export const BROWSER_FETCHERS: Fetcher[] = [openMeteo, wmoSunshine, cams, worldBank, wgi, oecd, openAlex, csoRent, oecdChildcare, nagerHolidays, labourLaw, politics, abortionLaw, couplesLaw, eurostatUrban, github];

export type OutcomeStatus = "ok" | "empty" | "failed" | "skipped";

export interface SourceOutcome {
  source: string;
  status: OutcomeStatus;
  /** How many figures it gave. */
  count: number;
  /** Why it failed or was skipped, in words. */
  reason?: string;
  ms: number;
}

/** A fetched place: the city, every figure with its provenance, and how each source went. */
export interface CityFetch {
  city: City;
  observations: Observation[];
  outcomes: SourceOutcome[];
  fetchedAt: string;
}

export interface FetchOptions {
  /** Only these sources (registry ids). */
  only?: string[];
  /** Called as each source starts and finishes, for a loading state. */
  onProgress?: (o: SourceOutcome | { source: string; status: "running" }) => void;
}

export async function fetchCity(city: City, ctx: FetchCtx, fetchers: Fetcher[], opts: FetchOptions = {}): Promise<CityFetch> {
  const chosen = fetchers.filter((f) => !opts.only || opts.only.includes(f.source));
  const outcomes: SourceOutcome[] = [];
  const observations: Observation[] = [];
  const run = async (f: Fetcher): Promise<void> => {
    const t0 = Date.now();
    const done = (o: Omit<SourceOutcome, "source" | "ms">) => {
      const out = { source: f.source, ms: Date.now() - t0, ...o };
      outcomes.push(out);
      opts.onProgress?.(out);
    };
    if (!f.runtimes.includes(ctx.runtime)) return done({ status: "skipped", count: 0, reason: ctx.runtime === "browser" ? "not readable from a browser (no CORS); the CLI or MCP server fetches it" : "browser only" });
    if (f.covers && !f.covers(city)) return done({ status: "skipped", count: 0, reason: "does not cover this place" });
    opts.onProgress?.({ source: f.source, status: "running" });
    try {
      const got = await f.fetch(city, ctx);
      observations.push(...got);
      done({ status: got.length ? "ok" : "empty", count: got.length, ...(got.length ? {} : { reason: "no figure for this place" }) });
    } catch (e) {
      done({ status: "failed", count: 0, reason: e instanceof Error ? e.message : String(e) });
    }
  };
  const primaries = chosen.filter((f) => !f.fallbackFor);
  await Promise.all(primaries.map(run));
  // A fallback runs when the source it stands in for gave nothing, could not run here, or was not asked for.
  for (const f of chosen.filter((x) => x.fallbackFor)) {
    const primary = outcomes.find((o) => o.source === f.fallbackFor);
    if (primary?.status === "ok") {
      const out: SourceOutcome = { source: f.source, status: "skipped", count: 0, reason: `not needed: ${f.fallbackFor} gave a figure`, ms: 0 };
      outcomes.push(out);
      opts.onProgress?.(out);
    } else await run(f);
  }
  const order = new Map(chosen.map((f, i) => [f.source, i]));
  outcomes.sort((a, b) => order.get(a.source)! - order.get(b.source)!);
  return { city, observations, outcomes, fetchedAt: ctx.now().toISOString() };
}

/**
 * The dataset a session uses: the committed snapshot plus the person's fetched places. A fetched place that the
 * snapshot also holds replaces the snapshot's figures source by source; a new place is added. Pure.
 */
export function withFetched(data: Dataset, fetched: CityFetch[]): Dataset {
  const cities = [...data.cities];
  const observations = { ...data.observations };
  for (const f of fetched) {
    if (!cities.some((c) => c.id === f.city.id)) cities.push(f.city);
    const fresh = new Set(f.observations.map((o) => `${o.source} ${o.metric}`));
    observations[f.city.id] = [...(observations[f.city.id] ?? []).filter((o) => !fresh.has(`${o.source} ${o.metric}`)), ...f.observations];
  }
  return { ...data, cities, observations };
}

/** Adds fetched places to a dataset in place (the MCP server keeps one dataset for its whole session). */
export function addFetched(data: Dataset, fetched: CityFetch[]): void {
  const merged = withFetched(data, fetched);
  data.cities = merged.cities;
  data.observations = merged.observations;
}
